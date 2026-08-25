/**
 * ====================================================================================
 * INIZIALIZZAZIONE MAPPA E STATO CONDIVISO (dashboard/mapCore.js)
 * ====================================================================================
 * Crea l'istanza Leaflet globale (window.map) e lo stato condiviso da tutti gli altri
 * moduli mappa (mapPopup.js, mapRoutes.js, mapHighlight.js): il layer group del
 * traffico live, le rotte/marker attivi, le coordinate "sorgente" (posizione del PC
 * locale) e la sessione attualmente evidenziata. Gestisce inoltre il ridimensionamento
 * del riquadro mappa e la geolocalizzazione browser/server per il punto di partenza.
 *
 * Deve essere il PRIMO file mappa caricato: mapHighlight.js referenzia `map` a livello
 * top-level (map.on('click', ...)), quindi richiede che sia già stato dichiarato qui.
 * ====================================================================================
 */

// --- INIZIALIZZAZIONE MAPPA LEAFLET ---
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

// ====================================================================================
// RESIZE BORDO INFERIORE MAPPA
// ====================================================================================
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

// ====================================================================================
// STRUTTURE DATI E STATO SELEZIONE (condivise con mapRoutes.js/mapPopup.js/mapHighlight.js)
// ====================================================================================
const activeMarkers = new Map();
const sessionRoutes = new Map();
let homeCoords = [43.7257, 12.6357]; // Coordinate di fallback per il punto di partenza dei pacchetti
let hasInitialLocationBeenSet = false;
let currentlyHighlightedSessionId = null;

const HIGHLIGHT_COLOR = '#facc15';

/**
 * Aggiorna le coordinate "sorgente" (punto di partenza logico dei pacchetti in uscita).
 * Non centra mai la mappa: resta sempre centrata globalmente sul mondo come richiesto.
 */
function setHomeLocation(coords) {
    if (coords && Array.isArray(coords) && coords.length === 2) {
        homeCoords = coords;
        hasInitialLocationBeenSet = true;
        console.log("[MAPPA] Posizione sorgente logica aggiornata:", homeCoords);
    }
}

// ====================================================================================
// GEOLOCALIZZAZIONE NATIVA BROWSER
// ====================================================================================
// Nota: l'evento socket 'home_location' (posizione stimata lato server) è gestito
// direttamente in dashboard.js, che chiama questa stessa setHomeLocation() — non va
// gestito qui perché al momento in cui questo script viene eseguito `socket` non è
// ancora stato dichiarato (dashboard.js carica molto più avanti nell'ordine script).
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
