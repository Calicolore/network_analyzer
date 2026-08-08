/**
 * ====================================================================================
 * UTILITY DI RETE E SUPPORTO APPLICATIVO (networkUtils.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Fornire funzioni ausiliarie e di supporto per la gestione della scheda di rete locale,
 * la formattazione dei dati dei pacchetti TCP e la generazione di elementi visivi.
 * 
 * FUNZIONAMENTO GENERALE:
 * 1. Generazione Colori Generativi: Calcola un colore HEX casuale ma ad alta luminosità
 *    per distinguere visivamente le sessioni di rete nella dashboard.
 * 2. Autodiscovery dell'IP di Rete: Ispeziona le interfacce di rete del sistema operativo (`os.networkInterfaces`),
 *    filtrando schede virtuali/VPN (es. NordLynx, TUN, TAP) per individuare l'IP IPv4 fisico attivo.
 * 3. Decodifica Flag TCP: Effettua un'analisi bitwise sulle flag del protocollo TCP per tradurle
 *    in etichette testuali comprensibili (SYN, ACK, PSH, FIN).
 * ====================================================================================
 */

const os = require('os');

/**
 * Genera un colore HEX casuale garantendo una buona luminosità per lo sfondo scuro della dashboard.
 * Usa solo cifre esadecimali alte (8-F) per evitare colori troppo scuri.
 * 
 * @returns {string} Codice colore in formato HEX (es. "#A2C3F1")
 */
function generateRandomColor() {
    const letters = '89ABCDEF'; 
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * letters.length)];
    }
    return color;
}

/**
 * Rileva automaticamente l'indirizzo IPv4 locale primario del dispositivo.
 * Esamina le interfacce di rete disponibili scartando quelle virtuali o di loopback.
 * 
 * @returns {string} Indirizzo IPv4 locale (es. "192.168.1.50") o "127.0.0.1" come fallback
 */
function getNetworkDeviceIP() {
    const interfaces = os.networkInterfaces();
    
    // Parole chiave per identificare prioritariamente le schede di rete fisiche reali
    const physicalKeywords = ['ethernet', 'wi-fi', 'eth0', 'wlan0', 'en0'];
    
    // PASSO 1: Ricerca prioritaria tra le schede con nome corrispondente alle parole chiave fisiche
    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        
        // Ignora interfacce virtuali e VPN note che potrebbero falsare l'IP monitorato
        if (lowerName.includes('nordlynx') || lowerName.includes('tun') || lowerName.includes('tap')) {
            continue;
        }

        if (physicalKeywords.some(keyword => lowerName.includes(keyword))) {
            for (const iface of interfaces[name]) {
                // Seleziona solo indirizzi IPv4 non interni (non loopback)
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }

    // PASSO 2: Fallback - Se non trova una scheda con nome standard, prende la prima interfaccia IPv4 non-loopback
    for (const name of Object.keys(interfaces)) {
        if (name.toLowerCase().includes('nordlynx')) continue;
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    // PASSO 3: Ultimo fallback su Loopback locale se nessuna scheda è connessa
    return '127.0.0.1';
}

/**
 * Converte la maschera di bit delle flag TCP in una stringa leggibile combinata da segni '+'.
 * 
 * @param {number} flags - Valore numerico o maschera di bit delle flag TCP
 * @returns {string} Stringa rappresentativa delle flag attive (es. "SYN+ACK", "ACK", "PSH+ACK")
 */
function translateFlags(flags) {
    const descriptions = [];
    
    // Controllo tramite bitwise AND dei singoli bit di stato TCP
    if (flags & 0x02) descriptions.push("SYN");
    if (flags & 0x10) descriptions.push("ACK");
    if (flags & 0x08) descriptions.push("PSH");
    if (flags & 0x01) descriptions.push("FIN");
    
    return descriptions.join("+") || "ACK";
}

module.exports = {
    generateRandomColor,
    getNetworkDeviceIP,
    translateFlags
};