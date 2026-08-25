/**
 * ====================================================================================
 * GESTORE MAPPA PER DB IMPORTATI (analytics/mapImportManager.js)
 * ====================================================================================
 *
 * SCOPO DEL MODULO:
 * Ricostruire graficamente sulla mappa Leaflet (la stessa mappa globale usata dalla
 * dashboard real-time, esposta come `window.map` da dashboard/mapCore.js) le sessioni
 * provenienti da un file JSON importato, sfruttando i campi `lat`/`lon` della
 * destinazione e l'array `hops` (nodi intermedi di traceroute) salvati su SQLite.
 *
 * Questo modulo è volutamente INDIPENDENTE dai file dashboard/map*.js:
 * - Non tocca né legge le strutture dati interne della mappa real-time (`sessionRoutes`,
 *   `activeMarkers`, evidenziazione, ecc.).
 * - Disegna tutto su un proprio Leaflet LayerGroup dedicato, che può essere svuotato
 *   con `clear()` in qualsiasi momento senza interferire col traffico live.
 *
 * NOTA SULL'ASSENZA DEL NODO "SORGENTE":
 * A differenza della mappa real-time (che conosce la posizione della macchina che sta
 * catturando il traffico), un DB importato può provenire da qualsiasi altro computer:
 * non abbiamo modo di conoscerne la posizione geografica reale. Per questo motivo le
 * rotte ricostruite qui NON includono un punto di partenza "Casa/Sorgente" fittizio,
 * ma solo la catena reale: [hop 1, hop 2, ..., destinazione finale].
 *
 * NOTA SULLA CARTELLA: risiede in analytics/ (non in dashboard/) perché è chiamato
 * solo da analytics/analyticsImport.js e gestisce dati di DB importati — pur
 * disegnando sulla stessa mappa Leaflet della vista live.
 * ====================================================================================
 */

window.MapImportManager = (function () {

    const IMPORT_ROUTE_COLOR_FALLBACK = '#facc15';
    let importLayerGroup = null;
    let renderedSessionIds = new Set();

    /**
     * Restituisce (creandolo se necessario) il layer group dedicato ai dati importati
     */
    function getLayerGroup() {
        if (!window.map) return null;
        if (!importLayerGroup) {
            importLayerGroup = L.layerGroup().addTo(window.map);
        }
        return importLayerGroup;
    }

    /**
     * Disegna un marker circolare per un nodo (hop o destinazione)
     */
    function createImportedMarker(layerGroup, latLng, color, isFinal, popupHtml) {
        const marker = L.circleMarker(latLng, {
            radius: isFinal ? 8 : 4,
            color: isFinal ? '#ffffff' : color,
            weight: isFinal ? 3 : 1.5,
            fillColor: color,
            fillOpacity: isFinal ? 1 : 0.75,
            interactive: true
        });

        if (popupHtml) marker.bindPopup(popupHtml);
        marker.addTo(layerGroup);
        return marker;
    }

    /**
     * Disegna una linea curva (stessa formula quadratica di Bézier usata in
     * dashboard/mapRoutes.js, duplicata qui volutamente per mantenere il modulo indipendente)
     */
    function drawImportedCurveLine(layerGroup, start, end, color) {
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

        const line = L.polyline(latlngs, {
            color: color,
            weight: 2.5,
            opacity: 0.65,
            dashArray: '4, 5', // Tratteggiata: distingue visivamente un percorso "storico/importato" da uno live
            smoothFactor: 1,
            interactive: false
        });

        line.addTo(layerGroup);
        return line;
    }

    /**
     * Costruisce il contenuto HTML del popup per un nodo importato
     */
    function buildPopupHtml(title, ip, cityOrName, extra) {
        return `
            <div style="font-family: monospace; min-width: 200px; color: #f1f5f9; padding: 4px;">
                <b style="color: #facc15; display: block; margin-bottom: 6px; font-size: 1.05em; border-bottom: 1px solid #334155; padding-bottom: 4px;">
                    📁 ${title}
                </b>
                <span style="color: #cbd5e1;">Nome: ${cityOrName || ip}</span><br>
                <span style="color: #94a3b8; font-size: 0.9em;">IP: ${ip}</span>
                ${extra || ''}
            </div>
        `;
    }

    /**
     * Disegna la rotta completa di una singola sessione importata (hop intermedi + destinazione).
     * Non disegna un punto "sorgente": la catena parte dal primo hop noto (se presente).
     */
    function renderSessionRoute(layerGroup, session) {
        if (!session || session.lat === null || session.lat === undefined || session.lon === null || session.lon === undefined) {
            return; // Sessione priva di coordinate: non rappresentabile sulla mappa
        }

        const color = session.sessionColor || IMPORT_ROUTE_COLOR_FALLBACK;
        const hops = Array.isArray(session.hops) ? [...session.hops].sort((a, b) => a.hop_number - b.hop_number) : [];

        // Catena di punti: hop intermedi (se presenti) + destinazione finale
        const points = hops
            .filter(h => h.lat !== null && h.lat !== undefined && h.lon !== null && h.lon !== undefined)
            .map(h => ({ latLng: [h.lat, h.lon], ip: h.ip, city: h.city, isFinal: false }));

        points.push({
            latLng: [session.lat, session.lon],
            ip: session.remote_ip,
            city: session.resource_name || session.host_name,
            isFinal: true
        });

        // Disegna le linee tra i punti consecutivi
        for (let i = 0; i < points.length - 1; i++) {
            drawImportedCurveLine(layerGroup, points[i].latLng, points[i + 1].latLng, color);
        }

        // Disegna i marker
        points.forEach((p, idx) => {
            const extra = p.isFinal
                ? `<br><span style="color: #10b981; font-size: 0.85em;">Servizio: ${session.service || 'N/A'}</span>
                   <br><span style="color: #94a3b8; font-size: 0.85em;">Byte totali: ${session.total_bytes || 0}</span>`
                : `<br><span style="color: #64748b; font-size: 0.8em;">Hop #${idx + 1} (transito)</span>`;

            const popup = buildPopupHtml(
                p.isFinal ? 'Destinazione (dati importati)' : 'Nodo intermedio (dati importati)',
                p.ip,
                p.city,
                extra
            );

            createImportedMarker(layerGroup, p.latLng, color, p.isFinal, popup);
        });
    }

    /**
     * Punto di ingresso pubblico: ricostruisce sulla mappa l'intero dataset importato
     */
    function renderDataset(sessions) {
        const layerGroup = getLayerGroup();
        if (!layerGroup) {
            console.warn('[MAP IMPORT] Mappa non ancora pronta (window.map non disponibile): rendering rimandato.');
            return;
        }

        clear();

        if (!Array.isArray(sessions) || sessions.length === 0) return;

        let drawnCount = 0;
        sessions.forEach(session => {
            renderSessionRoute(layerGroup, session);
            if (session.lat !== null && session.lat !== undefined) {
                drawnCount++;
                renderedSessionIds.add(session.session_id || session.sessionId);
            }
        });

        console.log(`[MAP IMPORT] Ricostruite ${drawnCount}/${sessions.length} sessioni sulla mappa (dataset importato).`);
    }

    /**
     * Svuota il layer dedicato ai dati importati, senza toccare la mappa real-time
     */
    function clear() {
        if (importLayerGroup) {
            importLayerGroup.clearLayers();
        }
        renderedSessionIds.clear();
    }

    return {
        renderDataset,
        clear
    };
})();
