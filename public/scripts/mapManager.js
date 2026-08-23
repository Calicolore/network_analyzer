/**
 * Gestore della Mappa e degli Elementi Grafici (Leaflet)
 */

// Inizializzazione mappa centrata sul mondo con zoom panoramico
const map = L.map('map', {
    center: [20, 0], // Centro globale della Terra
    zoom: 2,         // Zoom ampio per vedere tutto il pianeta
    worldCopyJump: true,
    maxBoundsViscosity: 1.0,
    preferCanvas: true
});

// Pannello dedicato per le hitbox
map.createPane('hitboxPane');
map.getPane('hitboxPane').style.zIndex = 650; 
map.getPane('hitboxPane').style.pointerEvents = 'auto';

// Tile Layer CartoDB
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
    minZoom: 2,
    noWrap: true
}).addTo(map);

// Confini massimi
const southWest = L.latLng(-89.98, -180);
const northEast = L.latLng(89.98, 180);
map.setMaxBounds(L.latLngBounds(southWest, northEast));

// Espone l'istanza Leaflet ad altri moduli (es. analytics.js per invalidateSize, mapImportManager.js
// per disegnare le rotte ricostruite da un DB importato)
window.map = map;

// Layer group dedicato a TUTTI gli elementi del traffico live (linee, hitbox, marker).
// Permette di "mettere in pausa" la mappa live (map.removeLayer(liveLayerGroup)) senza
// distruggere nulla: i marker/linee restano intatti in memoria con popup, colori e coordinate,
// pronti per essere riattaccati istantaneamente (map.addLayer(liveLayerGroup)) al ritorno da un DB importato.
const liveLayerGroup = L.layerGroup().addTo(map);

// --- RESIZE BORDO INFERIORE MAPPA ---
const mapContainer = document.getElementById('map-container');
const resizeHandle = document.getElementById('map-resize-handle');

if (mapContainer && resizeHandle) {
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = mapContainer.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newHeight = startHeight + (e.clientY - startY);
        if (newHeight >= 200 && newHeight <= window.innerHeight * 0.85) {
            mapContainer.style.height = `${newHeight}px`;
            map.invalidateSize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            map.invalidateSize();
        }
    });
}

if (mapContainer && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map.invalidateSize()).observe(mapContainer);
}

// --- STRUTTURE DATI E STATO SELEZIONE ---
const activeMarkers = new Map();
const sessionRoutes = new Map();
let homeCoords = [43.7257, 12.6357]; // Coordinate di fallback per il punto di partenza dei pacchetti
let hasInitialLocationBeenSet = false;
let currentlyHighlightedSessionId = null;

const HIGHLIGHT_COLOR = '#facc15';

function setHomeLocation(coords) {
    if (coords && Array.isArray(coords) && coords.length === 2) {
        homeCoords = coords;
        // NOTA: Nessun map.setView o panTo all'avvio. 
        // La mappa resta centrata globalmente sul mondo come richiesto.
        hasInitialLocationBeenSet = true;
        console.log("[MAPPA] Posizione sorgente logica aggiornata:", homeCoords);
    }
}

/**
 * Dizionario delle descrizioni contestuali per Datacenter/Provider noti e Servizi
 */
const PROVIDER_DESCRIPTIONS = {
    'Amazon AWS': 'Infrastruttura Cloud globale (AWS) utilizzata per l\'hosting di siti web, CDN, database e microservizi.',
    'Google Cloud': 'Datacenter e server di rete Google (GCP / 1e100) dedicati a servizi Web, streaming (YouTube) e API.',
    'Microsoft Azure': 'Infrastruttura Cloud Enterprise Microsoft per hosting aziendale, servizi Office 365, Windows Update e Copilot.',
    'Cloudflare': 'Rete di distribuzione dei contenuti (CDN) globale, sicurezza di rete e protezione anti-DDoS.'
};

const SERVICE_DESCRIPTIONS = {
    '443': 'Traffico cifrato HTTPS (SSL/TLS) per la trasmissione sicura di dati web.',
    '80': 'Traffico HTTP standard non cifrato per la navigazione web.',
    '53': 'Servizio DNS per la risoluzione dei nomi di dominio in indirizzi IP.',
    '22': 'Connessione di amministrazione remota sicura tramite protocollo SSH.'
};


// --- GEOLOCALIZZAZIONE NATIVA BROWSER ---
if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const deviceCoords = [position.coords.latitude, position.coords.longitude];
            console.log("[GEOLOC BROWSER] Posizione reale del dispositivo rilevata:", deviceCoords);
            setHomeLocation(deviceCoords);
        },
        (error) => {
            console.warn("[GEOLOC BROWSER] Impossibile accedere alla geolocalizzazione del browser:", error.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Listener evento Socket.io per posizione da server
if (typeof socket !== 'undefined') {
    socket.on('home_location', (data) => {
        if (!hasInitialLocationBeenSet && data && data.coords) {
            setHomeLocation(data.coords);
        }
    });
}

/**
 * Funzione unificata per applicare o rimuovere l'highlight/dimming (Mappa + Dashboard)
 */
window.highlightSession = function(sessionId) {
    if (currentlyHighlightedSessionId === sessionId) {
        window.clearHighlight();
        return;
    }

    currentlyHighlightedSessionId = sessionId;

    // 1. Scurimento / Evidenziazione Mappa
    sessionRoutes.forEach((route, sId) => {
        const isTarget = (sId === sessionId);

        route.lines.forEach(line => {
            line.setStyle({
                color: isTarget ? HIGHLIGHT_COLOR : route.color,
                opacity: isTarget ? 1.0 : 0.15,
                weight: isTarget ? 4.5 : 1.5
            });
            if (isTarget) line.bringToFront();
        });

        route.hopMarkers.forEach(marker => {
            marker.setStyle({
                color: isTarget ? '#ffffff' : (marker.options.isFinal ? '#ffffff' : route.color),
                fillColor: isTarget ? HIGHLIGHT_COLOR : route.color,
                fillOpacity: isTarget ? 1.0 : 0.15,
                weight: isTarget ? 3.5 : (marker.options.isFinal ? 3 : 1.5),
                radius: isTarget ? (marker.options.isFinal ? 9 : 6) : (marker.options.isFinal ? 8 : 4)
            });
            if (isTarget) marker.bringToFront();
        });
    });

    // 2. Scurimento Card Dashboard
    document.querySelectorAll('.session-card').forEach(card => {
        if (card.id === sessionId) {
            card.classList.add('highlighted-card');
            card.classList.remove('dimmed-card');
        } else {
            card.classList.remove('highlighted-card');
            card.classList.add('dimmed-card');
        }
    });
};

/**
 * Ripristina lo stato visivo originale di tutti gli elementi
 */
window.clearHighlight = function() {
    currentlyHighlightedSessionId = null;

    sessionRoutes.forEach((route) => {
        route.lines.forEach(line => {
            line.setStyle({
                color: route.color,
                opacity: 0.7,
                weight: 2.5
            });
        });

        route.hopMarkers.forEach((marker) => {
            const isFinal = marker.options.isFinal;
            const isSource = marker.options.isSource;

            marker.setStyle({
                color: isFinal ? '#ffffff' : route.color,
                fillColor: route.color,
                fillOpacity: isFinal ? 1 : 0.8,
                weight: isFinal ? 3 : 1.5,
                radius: isFinal ? 8 : (isSource ? 6 : 4)
            });
        });
    });

    document.querySelectorAll('.session-card').forEach(card => {
        card.classList.remove('highlighted-card');
        card.classList.remove('dimmed-card');
    });
};

// Cliccando sulla mappa vuota si rimuove l'highlight
map.on('click', (e) => {
    if (typeof window.clearHighlight === 'function') {
        const target = e.originalEvent.target;
        if (target.classList.contains('leaflet-container') || target.classList.contains('leaflet-tile') || target.closest('.leaflet-container')) {
            window.clearHighlight();
        }
    }
});

/**
 * Invocato al click sulla Card: gestisce il toggle dell'highlight e centra la mappa
 */
window.focusLastHop = function(sessionId) {
    if (currentlyHighlightedSessionId === sessionId) {
        window.clearHighlight();
        return;
    }

    window.highlightSession(sessionId);

    const route = sessionRoutes.get(sessionId);
    if (route && route.hopMarkers.length > 0) {
        const lastMarker = route.hopMarkers[route.hopMarkers.length - 1];
        map.setView(lastMarker.getLatLng(), 6, { animate: true, duration: 0.8 });
        lastMarker.openPopup();
    }
};

/**
 * Disegna la linea curva con un'hitbox d'interazione reattiva
 */
function drawCurveLine(start, end, color, sessionId) {
    const latlngs = [];
    const offsetX = (start[0] + end[0]) / 2;
    const offsetY = (start[1] + end[1]) / 2;
    
    const curvature = 0.15; 
    const controlPoint = [
        offsetX + (end[1] - start[1]) * curvature,
        offsetY - (end[0] - start[0]) * curvature
    ];
    
    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const lat = (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * controlPoint[0] + t * t * end[0];
        const lng = (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * controlPoint[1] + t * t * end[1];
        latlngs.push([lat, lng]);
    }
    
    // Gestore del click: Evidenzia e apre il popup dell'ultimo hop
    const onLineClick = (e) => {
        L.DomEvent.stopPropagation(e);
        
        // Se non è già la sessione evidenziata, la evidenzia
        if (currentlyHighlightedSessionId !== sessionId) {
            window.highlightSession(sessionId);
        }

        // Apre il popup dell'ultimo hop di questa rotta
        const route = sessionRoutes.get(sessionId);
        if (route && route.hopMarkers.length > 0) {
            const lastMarker = route.hopMarkers[route.hopMarkers.length - 1];
            lastMarker.openPopup();
        }
    };

    // 1. Linea visibile
    const visibleLine = L.polyline(latlngs, {
        color: color,
        weight: 3,
        opacity: 0.8,
        smoothFactor: 1,
        interactive: true
    }).addTo(liveLayerGroup);

    // 2. Hitbox invisibile per facilitare il click
    const invisibleHitbox = L.polyline(latlngs, {
        color: '#000000',
        weight: 35,
        opacity: 0,
        interactive: true,
        pane: 'hitboxPane',   
        bubblingMouseEvents: false
    }).addTo(liveLayerGroup);

    // Collega gli eventi
    [visibleLine, invisibleHitbox].forEach(line => {
        line.on('click', onLineClick);
        line.on('mouseover', () => {
            document.getElementById('map').style.cursor = 'pointer';
        });
        line.on('mouseout', () => {
            document.getElementById('map').style.cursor = '';
        });
    });

    visibleLine._hitbox = invisibleHitbox;
    return visibleLine;
}

/**
 * Genera l'HTML dei Popup con Descrizioni Contestuali
 */
function getHopPopupHTML(sessionId, currentIndex, totalHops, currentIp, currentCity, remotePort, technicalSubtitle, providerName) {
    const isFirst = currentIndex === 0;
    const isLast = currentIndex === totalHops - 1;

    let nodeType = isFirst ? "Sorgente" : (isLast ? "Destinatario" : "Intermedio");
    let hopTitle = isFirst ? "Sorgente (Inizio)" : (isLast ? `Hop #${currentIndex} (Fine)` : `Hop #${currentIndex}`);

    let nameDisplay = currentCity;
    if (!nameDisplay || nameDisplay.toLowerCase() === "risorsa web" || nameDisplay === currentIp || nameDisplay === "Nodo di Rete") {
        nameDisplay = isFirst ? "Mio PC" : currentIp; 
    }

    const subtitleRow = (technicalSubtitle && technicalSubtitle !== nameDisplay)
        ? `<span style="color: #94a3b8; font-size: 0.85em; display:block; margin-top: 2px;">DNS: ${technicalSubtitle}</span>`
        : "";

    // Riga Datacenter / Provider
    const providerRow = providerName 
        ? `<span style="color: #f59e0b; font-size: 0.9em; font-weight: bold; display:block; margin-top: 4px;">🏢 Provider: ${providerName}</span>` 
        : "";

    // --- BOX DESCRIZIONE CONTESTUALE ---
    let contextBox = '';
    if (providerName && PROVIDER_DESCRIPTIONS[providerName]) {
        contextBox = `
            <div style="color: #cbd5e1; font-size: 0.8em; line-height: 1.35; background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #f59e0b; margin-top: 8px;">
                💡 <b>Info Datacenter:</b><br>${PROVIDER_DESCRIPTIONS[providerName]}
            </div>`;
    } else if (isFirst) {
        contextBox = `
            <div style="color: #cbd5e1; font-size: 0.8em; line-height: 1.35; background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #10b981; margin-top: 8px;">
                💻 <b>Origine Locale:</b> Il tuo dispositivo da cui origina la sessione di rete.
            </div>`;
    } else if (remotePort && SERVICE_DESCRIPTIONS[remotePort]) {
        contextBox = `
            <div style="color: #cbd5e1; font-size: 0.8em; line-height: 1.35; background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #38bdf8; margin-top: 8px;">
                ℹ️ <b>Info Servizio:</b><br>${SERVICE_DESCRIPTIONS[remotePort]}
            </div>`;
    }

    const portRow = (!isFirst && remotePort)
        ? `<span style="color: #38bdf8;">Porta: ${remotePort}</span><br>`
        : "";

    let nameRow = '';
    if (isFirst) {
        nameRow = `<span style="color: #cbd5e1;">Nome: ${nameDisplay}</span>`;
    } else {
        const isDomain = nameDisplay.includes('.') && nameDisplay !== currentIp && !nameDisplay.startsWith('192.168');
        
        if (isDomain) {
            nameRow = `<span style="color: #cbd5e1;">Nome: <a href="https://${nameDisplay}" target="_blank" style="color: #38bdf8; text-decoration: underline;" title="Apri sito web">🌐 ${nameDisplay}</a></span>`;
        } else {
            const searchQuery = nameDisplay;
            nameRow = `<span style="color: #cbd5e1;">Nome: ${nameDisplay}</span> <a href="https://www.google.com/search?q=${encodeURIComponent(searchQuery)}" target="_blank" style="color: #38bdf8; font-size: 0.85em; text-decoration: none;" title="Cerca risorsa">🔍 [Cerca]</a>`;
        }
    }

    return `
        <div style="font-family: monospace; min-width: 220px; color: #f1f5f9; padding: 5px;">
            <b style="color: #38bdf8; display: block; margin-bottom: 8px; font-size: 1.1em; border-bottom: 1px solid #334155; padding-bottom: 4px;">
                ${hopTitle}
            </b>
            <span style="color: #10b981; font-weight: bold;">Nodo: ${nodeType}</span><br>
            ${nameRow}
            ${subtitleRow}
            ${providerRow}<br>
            <span style="color: #94a3b8; font-size: 0.95em;">IP: ${currentIp}</span><br>
            ${portRow}
            ${contextBox}
            
            <div style="display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #334155; padding-top: 8px;">
                <button ${isFirst ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''} 
                    onclick="window.navigateHop('${sessionId}', ${currentIndex - 1})" 
                    style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    ◀ Prec
                </button>
                <span style="color: #38bdf8; font-weight: bold; align-self: center;">${currentIndex}/${totalHops - 1}</span>
                <button ${isLast ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''} 
                    onclick="window.navigateHop('${sessionId}', ${currentIndex + 1})" 
                    style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    Succ ▶
                </button>
            </div>
        </div>
    `;
}

window.navigateHop = function(sessionId, targetIndex) {
    const route = sessionRoutes.get(sessionId);
    if (!route || !route.hopMarkers[targetIndex]) return;
    
    const targetMarker = route.hopMarkers[targetIndex];
    map.panTo(targetMarker.getLatLng(), { animate: true });
    targetMarker.openPopup();
};

/**
 * Crea marker punto sulla mappa
 */
function createCustomMarker(latLng, color, isFinal = false, isSource = false, sessionId = '') {
    const marker = L.circleMarker(latLng, {
        radius: isFinal ? 8 : (isSource ? 6 : 4),
        color: isFinal ? '#ffffff' : color,
        weight: isFinal ? 3 : 1.5,
        fillColor: color,
        fillOpacity: isFinal ? 1 : 0.8,
        interactive: true,
        isFinal: isFinal,
        isSource: isSource
    }).addTo(liveLayerGroup);

    if (sessionId) {
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            
            // Evidenzia la sessione se non lo è già
            if (currentlyHighlightedSessionId !== sessionId) {
                window.highlightSession(sessionId);
            }
            
            // Apre il popup del marker specifico su cui si è cliccato
            marker.openPopup();
        });
    }

    return marker;
}

/**
 * Aggiorna pacchetti sulla mappa
 */
function updateMapPacket(data) {
    if (!data.lat || !data.lon) return;

    if (!sessionRoutes.has(data.sessionId)) {
        sessionRoutes.set(data.sessionId, {
            color: data.sessionColor,
            points: [homeCoords, [data.lat, data.lon]], 
            lines: [],
            hopMarkers: [],
            ips: ['Localhost', data.remoteIp],
            cities: ['Sorgente', data.resourceName],
            subtitle: data.technicalSubtitle || '',
            provider: data.provider || null,
            providers: [null, data.provider || null]
        });

        const route = sessionRoutes.get(data.sessionId);

        const isAnotherHighlighted = currentlyHighlightedSessionId && (currentlyHighlightedSessionId !== data.sessionId);

        const startMarker = createCustomMarker(homeCoords, data.sessionColor, false, true, data.sessionId);
        startMarker.bindPopup(getHopPopupHTML(data.sessionId, 0, 2, 'Localhost', 'Sorgente', data.remotePort, ''));
        route.hopMarkers.push(startMarker);

        const line = drawCurveLine(homeCoords, [data.lat, data.lon], data.sessionColor, data.sessionId);
        route.lines.push(line);

        const finalMarker = createCustomMarker([data.lat, data.lon], data.sessionColor, true, false, data.sessionId);
        finalMarker.bindPopup(getHopPopupHTML(data.sessionId, 1, 2, data.remoteIp, data.resourceName, data.remotePort, data.technicalSubtitle, data.provider));

        route.hopMarkers.push(finalMarker);
        activeMarkers.set(data.sessionId, finalMarker);

        if (isAnotherHighlighted) {
            line.setStyle({
                color: route.color,
                opacity: 0.15,
                weight: 1.5
            });

            startMarker.setStyle({
                fillOpacity: 0.15,
                weight: 1.5,
                radius: 6
            });

            finalMarker.setStyle({
                fillOpacity: 0.15,
                weight: 1.5,
                radius: 8
            });
        }
    } else if (activeMarkers.has(data.sessionId)) {
        const finalMarker = activeMarkers.get(data.sessionId);
        const route = sessionRoutes.get(data.sessionId);
        if (route) {
            route.cities[route.cities.length - 1] = data.resourceName;
            route.subtitle = data.technicalSubtitle || '';
            route.provider = data.provider || null;
            if (route.providers) route.providers[route.providers.length - 1] = data.provider || null;
            
            finalMarker.setPopupContent(getHopPopupHTML(data.sessionId, route.points.length - 1, route.points.length, data.remoteIp, data.resourceName, data.remotePort, data.technicalSubtitle, data.provider));
        }
    }
}

/**
 * Aggiorna traceroute
 */
function updateMapTraceroute(data) {
    for (const [sessionId, route] of sessionRoutes.entries()) {
        const remoteIpOfSession = sessionId.split(':')[0];

        if (remoteIpOfSession === data.targetIp) {
            const hopLatLng = [data.lat, data.lon];
            
            if (route.points.some(p => p[0] === hopLatLng[0] && p[1] === hopLatLng[1])) return;

            route.lines.forEach(l => {
                if (l._hitbox) liveLayerGroup.removeLayer(l._hitbox);
                liveLayerGroup.removeLayer(l);
            });
            route.hopMarkers.forEach(m => liveLayerGroup.removeLayer(m));
            route.lines = [];
            route.hopMarkers = [];

            route.points.splice(route.points.length - 1, 0, hopLatLng);
            route.ips.splice(route.ips.length - 1, 0, data.ip);
            route.cities.splice(route.cities.length - 1, 0, route.cities[route.cities.length - 1]);

            if (!route.providers) {
                route.providers = [null, route.provider || null];
            }
            route.providers.splice(route.providers.length - 1, 0, data.provider || null);

            const extractedPort = sessionId.split(':')[1] || '';
            const isTargetSession = (currentlyHighlightedSessionId === sessionId);
            const isAnotherHighlighted = currentlyHighlightedSessionId && !isTargetSession;

            for (let i = 0; i < route.points.length; i++) {
                const currentPoint = route.points[i];
                const isLast = (i === route.points.length - 1);
                const isFirst = (i === 0);

                const marker = createCustomMarker(currentPoint, route.color, isLast, isFirst, sessionId);
                const currentSubtitle = isLast ? route.subtitle : `Nodo di transito per ${route.cities[i]}`;
                const currentProvider = route.providers ? route.providers[i] : null;
                
                marker.bindPopup(getHopPopupHTML(sessionId, i, route.points.length, route.ips[i], route.cities[i], extractedPort, currentSubtitle, currentProvider));
                
                if (isAnotherHighlighted) {
                    marker.setStyle({
                        color: isLast ? '#ffffff' : route.color,
                        fillColor: route.color,
                        fillOpacity: 0.15,
                        weight: isLast ? 3 : 1.5,
                        radius: isLast ? 8 : (isFirst ? 6 : 4)
                    });
                } else if (isTargetSession) {
                    marker.setStyle({
                        color: '#ffffff',
                        fillColor: HIGHLIGHT_COLOR,
                        fillOpacity: 1.0,
                        weight: isLast ? 3.5 : 1.5,
                        radius: isLast ? 9 : 6
                    });
                }

                route.hopMarkers.push(marker);

                if (i < route.points.length - 1) {
                    const nextPoint = route.points[i + 1];
                    const curve = drawCurveLine(currentPoint, nextPoint, route.color, sessionId);

                    if (isAnotherHighlighted) {
                        curve.setStyle({
                            color: route.color,
                            opacity: 0.15,
                            weight: 1.5
                        });
                    } else if (isTargetSession) {
                        curve.setStyle({
                            color: HIGHLIGHT_COLOR,
                            opacity: 1.0,
                            weight: 4.5
                        });
                    }

                    route.lines.push(curve);
                }
            }
            break;
        }
    }
}

/**
 * Rimozione sessione dalla mappa
 */
function removeSessionFromMap(sessionId) {
    if (currentlyHighlightedSessionId === sessionId) {
        window.clearHighlight();
    }
    const route = sessionRoutes.get(sessionId);
    if (route) {
        route.lines.forEach(line => {
            if (line._hitbox) liveLayerGroup.removeLayer(line._hitbox); // Rimuove l'hitbox associata
            liveLayerGroup.removeLayer(line);
        });
        route.hopMarkers.forEach(marker => liveLayerGroup.removeLayer(marker));
        sessionRoutes.delete(sessionId);
    }
    activeMarkers.delete(sessionId);
}

/**
 * ====================================================================================
 * PAUSA / RIPRESA DEL TRAFFICO LIVE (per la modalità "DB Importato")
 * ====================================================================================
 * Staccare/riattaccare l'intero layerGroup NON distrugge nulla: sessionRoutes e
 * activeMarkers restano invariati in memoria. Il ripristino al ritorno da un DB
 * importato è quindi istantaneo e pixel-identico a come si trovava prima della pausa,
 * senza bisogno di richiedere nulla al server.
 * ====================================================================================
 */
function pauseLiveTraffic() {
    if (map.hasLayer(liveLayerGroup)) {
        map.removeLayer(liveLayerGroup);
        console.log('[MAPPA] Traffico live nascosto (DB importato attivo).');
    }
}

function resumeLiveTraffic() {
    if (!map.hasLayer(liveLayerGroup)) {
        map.addLayer(liveLayerGroup);
        console.log('[MAPPA] Traffico live ripristinato.');
    }
}

window.MapManager = window.MapManager || {};
window.MapManager.pauseLiveTraffic = pauseLiveTraffic;
window.MapManager.resumeLiveTraffic = resumeLiveTraffic;