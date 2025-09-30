// --- Globale Variablen ---
const STORAGE_KEY_MESSAGES = 'p2p_chat_messages';
const STORAGE_KEY_GROUP = 'p2p_chat_group';

let myID;
let peer;
const activeConnections = {}; 
let messages = []; 
let currentGroup = {
    name: null,
    members: new Map(),
};

// DOM-Elemente
const myIdDisplay = document.getElementById('my-id');
const groupNameInput = document.getElementById('group-name-input');
const memberIdInput = document.getElementById('member-id-input');
const groupNameDisplay = document.getElementById('group-name-display');
const memberListDiv = document.getElementById('member-list');
const chatWindow = document.getElementById('chat-window');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');


// ##########################################
// # LOKALE SPEICHERUNG (Local Storage)
// ##########################################

function saveMessagesToLocalStorage() {
    localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
}

function loadMessagesFromLocalStorage() {
    const storedMessages = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (storedMessages) {
        messages = JSON.parse(storedMessages);
        messages.forEach(msg => {
            if (msg.type !== 'system') {
                displayMessage(msg, msg.type, false); // 'false' verhindert erneutes Speichern
            }
        });
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    const storedGroup = localStorage.getItem(STORAGE_KEY_GROUP);
    if (storedGroup) {
        const groupData = JSON.parse(storedGroup);
        currentGroup.name = groupData.name;
        groupNameDisplay.textContent = groupData.name;
        
        currentGroup.members = new Map(groupData.members);
        currentGroup.members.forEach(member => member.isConnected = false); 

        renderMemberList();
        sendBtn.disabled = false;
        messageInput.disabled = false;
        displayMessage("Lokale Gruppe geladen. Bitte Peers neu verbinden.", 'system');
    }
}

function saveGroupToLocalStorage() {
    const groupData = {
        name: currentGroup.name,
        members: Array.from(currentGroup.members.entries()) 
    };
    localStorage.setItem(STORAGE_KEY_GROUP, JSON.stringify(groupData));
}


// ##########################################
// # GRUPPEN- & P2P-LOGIK
// ##########################################

function getOrCreateID() {
    let id = localStorage.getItem('myP2PID');
    if (!id) {
        id = 'P2P_USER_' + Math.random().toString(36).substring(2, 6).toUpperCase();
        localStorage.setItem('myP2PID', id);
    }
    myID = id;
    myIdDisplay.textContent = id;
}

function initializePeer() {
    peer = new Peer(myID);

    peer.on('open', (id) => {
        console.log('Mit Signalling Server verbunden. Eigene ID:', id);
    });

    peer.on('connection', (conn) => {
        setupConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('PeerJS Fehler:', err);
    });
}


document.getElementById('add-member-btn').addEventListener('click', () => {
    const memberID = memberIdInput.value.trim().toUpperCase();
    if (memberID && memberID !== myID && !currentGroup.members.has(memberID)) {
        currentGroup.members.set(memberID, { isConnected: false });
        displayMessage(`Mitglied ${memberID} zur Gruppe hinzugefügt.`, 'system');
        memberIdInput.value = '';
        saveGroupToLocalStorage();
        renderMemberList();
    } else {
        alert('Ungültige oder doppelte ID.');
    }
});

document.getElementById('start-group-btn').addEventListener('click', () => {
    const name = groupNameInput.value.trim();
    if (name) {
        currentGroup.name = name;
        groupNameDisplay.textContent = name;
        displayMessage(`Gruppe '${name}' gestartet/gewechselt.`, 'system');
        saveGroupToLocalStorage();
        renderMemberList();
        
        sendBtn.disabled = false;
        messageInput.disabled = false;
    } else {
        alert('Bitte gib einen Gruppennamen ein.');
    }
});

groupNameDisplay.addEventListener('click', () => {
    memberListDiv.style.display = memberListDiv.style.display === 'none' ? 'block' : 'none';
});

function renderMemberList() {
    memberListDiv.innerHTML = '<strong>Mitglieder:</strong>';
    currentGroup.members.forEach((member, id) => {
        const item = document.createElement('div');
        item.className = 'member-item';
        const statusText = member.isConnected ? 'Verbunden ✅' : 'Nicht verbunden 🔴';
        
        item.innerHTML = `
            <span>${id} (${statusText})</span>
            <button onclick="attemptConnection('${id}')" 
                    ${member.isConnected ? 'disabled' : ''}>
                Verbinden
            </button>
        `;
        memberListDiv.appendChild(item);
    });
}

function attemptConnection(targetID) {
    // Manuelle und automatische Option wie gewünscht
    const promptValue = prompt(`Mit ${targetID} verbinden:\n1: Automatisch (ID verwenden)\n2: Manuell (ID manuell eingeben)`, '1');
    
    let peerToConnect = targetID;
    if (promptValue === '2') {
        const manualID = prompt(`Bitte gib die ID von ${targetID} erneut ein (Verifizierung).`);
        if (!manualID) return;
        peerToConnect = manualID; 
    } else if (promptValue !== '1') {
        return;
    }

    if (activeConnections[peerToConnect]) {
        alert(`Bereits mit ${peerToConnect} verbunden.`);
        return;
    }
    
    displayMessage(`Versuche, P2P-Verbindung zu ${peerToConnect} herzustellen...`, 'system');
    const conn = peer.connect(peerToConnect);
    
    conn.on('open', () => {
        setupConnection(conn);
    });
    conn.on('error', (err) => {
        console.error('Verbindungsfehler:', err);
        displayMessage(`Fehler: Verbindung zu ${peerToConnect} fehlgeschlagen. Ist die ID online?`, 'system');
    });
}

function setupConnection(conn) {
    const peerID = conn.peer;
    activeConnections[peerID] = conn; 
    
    if (currentGroup.members.has(peerID)) {
        currentGroup.members.get(peerID).isConnected = true;
        renderMemberList();
    }

    conn.on('open', () => {
        displayMessage(`P2P-Verbindung zu Gruppenmitglied ${peerID} hergestellt!`, 'system');
    });

    // EMPFANGS-LOGIK: MESSAGE FLOODING
    conn.on('data', (data) => {
        try {
            const message = JSON.parse(data);

            // Verhindere Flooding-Schleifen: Nachricht nicht an Sender zurückleiten und doppelte Nachrichten unterdrücken
            if (message.sender === myID) return; 

            // 1. Nachricht lokal anzeigen und speichern
            displayMessage(message, 'partner');

            // 2. Flooding (Weiterleitung an alle anderen verbundenen Peers)
            const payload = JSON.stringify(message); 

            for (const otherPeerId in activeConnections) {
                // Sende nicht zurück an den Peer, von dem die Nachricht kam (peerID), 
                // und nicht an den ursprünglichen Sender (message.sender).
                if (otherPeerId !== peerID && activeConnections[otherPeerId].open && otherPeerId !== message.sender) {
                    activeConnections[otherPeerId].send(payload);
                }
            }

        } catch (e) {
             console.error('Fehler beim Parsen der empfangenen Nachricht:', e);
             displayMessage(`[${peerID} sendete unlesbare Daten]`, 'system');
        }
    });

    conn.on('close', () => {
        delete activeConnections[peerID];
        if (currentGroup.members.has(peerID)) {
            currentGroup.members.get(peerID).isConnected = false;
            renderMemberList();
        }
        displayMessage(`Verbindung zu ${peerID} getrennt.`, 'system');
    });
}


// --- 4. Nachrichtenversand (Flutung im Mesh) ---

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});
sendBtn.addEventListener('click', sendMessage);

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || Object.keys(activeConnections).length === 0) {
        alert('Bitte gib eine Nachricht ein und verbinde dich zuerst mit mindestens einem Mitglied.');
        return;
    }
    
    // Erstelle das standardisierte JSON-Nachrichtenobjekt
    const messageObject = { 
        sender: myID, 
        text: text, 
        timestamp: Date.now() 
    };
    const payload = JSON.stringify(messageObject);
    
    // 1. Nachricht lokal anzeigen und speichern
    displayMessage(messageObject, 'me');
    messageInput.value = '';

    // 2. Flooding (Flutung): Sende die Nachricht an ALLE verbundenen Peers
    for (const peerId in activeConnections) {
        if (activeConnections[peerId].open) {
            activeConnections[peerId].send(payload);
        }
    }
}


// Hilfsfunktion zur Anzeige von Nachrichten und Speicherung
function displayMessage(data, type, shouldSave = true) {
    // 1. Nachrichten-Objekt standardisieren (für LocalStorage)
    const messageObject = (type === 'me' || type === 'partner') ? data : 
        { type: 'system', text: data, timestamp: Date.now() };

    // 2. DOM-Element erstellen
    const msgElement = document.createElement('div');
    let displayText;
    
    if (type === 'me') {
        displayText = `Ich: ${messageObject.text}`;
        msgElement.className = 'message me';
    } else if (type === 'partner') {
        displayText = `[${messageObject.sender}]: ${messageObject.text}`;
        msgElement.className = 'message partner';
    } else {
        displayText = messageObject.text;
        msgElement.className = 'message system';
    }
    
    msgElement.textContent = displayText;
    chatWindow.appendChild(msgElement);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // 3. Im Speicher ablegen (nur wenn es keine Lade-Operation ist)
    if (shouldSave) {
        messages.push({ type: type, ...messageObject });
        saveMessagesToLocalStorage();
    }
}


// --- App-Start ---
document.addEventListener('DOMContentLoaded', () => {
    getOrCreateID();
    loadMessagesFromLocalStorage(); // Zuerst gespeicherte Nachrichten laden
    initializePeer();
});
