/**
 * ====================================================================================
 * SERVIZIO MAPPATURA E IDENTIFICAZIONE SERVIZI / PORTE (portService.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Tradurre i numeri delle porte di rete (TCP/UDP) in nomi di servizio o protocolli 
 * leggibili (es. Porta 443 -> HTTPS, Porta 80 -> HTTP, Porta 22 -> SSH).
 * 
 * FUNZIONAMENTO GENERALE:
 * 1. Mappatura Dizionario: Utilizza un dizionario statico (`COMMON_PORTS`) contenente
 *    i principali protocolli di rete e database associati alle rispettive porte standard.
 * 2. Risoluzione Gerarchica: Se lo sniffer della scheda di rete ha già riconosciuto
 *    un protocollo (es. durante l'ispezione dei pacchetti), mantiene quel valore.
 * 3. Fallback Dinamico: Se la porta non è presente nella lista comune e lo sniffer non
 *    ha fornito dettagli, genera un'etichetta generica pulita (es. `PORT-51234`).
 * ====================================================================================
 */

/**
 * Tabella di corrispondenza per le porte di rete più diffuse
 */
const COMMON_PORTS = {
    80: 'HTTP',
    443: 'HTTPS',
    53: 'DNS',
    22: 'SSH',
    21: 'FTP',
    25: 'SMTP',
    110: 'POP3',
    143: 'IMAP',
    3306: 'MySQL',
    5432: 'PostgreSQL',
    27017: 'MongoDB',
    6379: 'Redis',
    1883: 'MQTT',
    8080: 'HTTP-Alt',
    8443: 'HTTPS-Alt'
};

/**
 * Determina il nome del servizio partendo dalla porta remota o da un valore rilevato dallo sniffer
 * 
 * @param {number} port - La porta di rete della connessione remota
 * @param {string} [fallbackService] - Nome del servizio eventualmente estratto in precedenza
 * @returns {string} Nome del servizio identificato o etichetta della porta
 */
function getServiceName(port, fallbackService) {
    // PASSO 1: Se lo sniffer ha già identificato un servizio valido, lo usiamo
    if (fallbackService && fallbackService !== 'Unknown' && fallbackService !== 'Sconosciuto') {
        return fallbackService;
    }
    
    // PASSO 2: Cerchiamo nel dizionario delle porte note, altrimenti generiamo un nome generico
    return COMMON_PORTS[port] || `PORT-${port}`;
}

module.exports = {
    getServiceName
};