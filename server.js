const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const compression = require('compression');

const app = express();
const server = http.createServer(app);

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const HISTORY_FILE = path.join(__dirname, 'chat-history.json');
let messagesHistory = [];
// Хранилище активных онлайн-пользователей
let activeUsers = {}; 

if (fs.existsSync(HISTORY_FILE)) {
    try { messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } 
    catch (e) { messagesHistory = []; }
}

function saveHistory() {
    fs.writeFile(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2), (err) => {
        if (err) console.error("Ошибка записи истории:", err);
    });
}

// Пинг от клиента, чтобы сервер знал, кто в сети
app.post('/ping', (req, res) => {
    const { userId, name } = req.body;
    if (userId && name) {
        activeUsers[userId] = { name, lastSeen: Date.now() };
    }
    // Удаляем тех, кто не пинговал больше 8 секунд
    const now = Date.now();
    Object.keys(activeUsers).forEach(id => {
        if (now - activeUsers[id].lastSeen > 8000) delete activeUsers[id];
    });
    res.json(activeUsers);
});

// Получение истории конкретного чата между двумя пользователями
app.get('/history', (req, res) => {
    const { senderId, receiverId } = req.query;
    
    // Фильтруем сообщения: либо (от А к Б), либо (от Б к А)
    const chatLog = messagesHistory.filter(msg => {
        if (receiverId === 'favorites') {
            return msg.receiverId === 'favorites' && msg.senderId === senderId;
        }
        return (msg.senderId === senderId && msg.receiverId === receiverId) ||
               (msg.senderId === receiverId && msg.receiverId === senderId);
    });
    
    res.json(chatLog);
});

app.post('/message', (req, res) => {
    const data = req.body; // Ожидаем: id, name, senderId, receiverId, text, file, fileType
    if (data && data.senderId && data.receiverId && (data.text || data.file)) {
        messagesHistory.push(data);
        if (messagesHistory.length > 100) messagesHistory.shift();
        saveHistory();
        res.json(data);
    } else {
        res.status(400).json({ error: "Неверный формат" });
    }
});

app.delete('/message/:id', (req, res) => {
    const messageId = req.params.id;
    const initialLength = messagesHistory.length;
    messagesHistory = messagesHistory.filter(msg => String(msg.id) !== String(messageId));
    if (messagesHistory.length !== initialLength) {
        saveHistory();
        res.json({ success: true, id: messageId });
    } else {
        res.status(404).json({ error: "Не найдено" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
