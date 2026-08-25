/**
 * ====================================================================================
 * EVIDENZIAZIONE ROTTE E NAVIGAZIONE HOP (dashboard/mapHighlight.js)
 * ====================================================================================
 * Gestisce l'evidenziazione/attenuazione (highlight/dim) di una rotta sulla mappa e
 * della relativa card, sincronizzando i due lati dell'interfaccia. Include anche la
 * navigazione avanti/indietro tra gli hop di una rotta dal popup mappa.
 * Dipende da: mapCore.js (map, sessionRoutes, currentlyHighlightedSessionId,
 * HIGHLIGHT_COLOR), mapRoutes.js (centerAndOpenPopup). Contiene un listener top-level
 * `map.on('click', ...)` che richiede `map` già dichiarato — deve caricare DOPO
 * mapCore.js.
 * ====================================================================================
 */

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
    // NOTA: 'dimmed-card' è riservata a QUESTA feature (evidenziazione), distinta da
    // 'idle-card' (sessione inattiva per timeout, vedi uiCardHelpers.js) — non vanno
    // mai unificate, altrimenti evidenziare/deselezionare una rotta cancellerebbe lo
    // stato "inattiva" di altre card non correlate.
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
        centerAndOpenPopup(lastMarker, 6);
    }
};

/**
 * Invocato dai pulsanti Prec/Succ nel popup: naviga verso un altro hop della stessa rotta
 */
window.navigateHop = function(sessionId, targetIndex) {
    const route = sessionRoutes.get(sessionId);
    if (!route || !route.hopMarkers[targetIndex]) return;

    const targetMarker = route.hopMarkers[targetIndex];
    centerAndOpenPopup(targetMarker);
};
