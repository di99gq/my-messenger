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
const USERS_FILE = path.join(__dirname, 'users.json');

let messagesHistory = [];
let usersDatabase = {}; // База: { "уникальный_ник": { id, name, password, avatar } }
let activeUsers = {};   // Текущий онлайн в памяти

if (fs.existsSync(HISTORY_FILE)) {
    try { messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } 
    catch (e) { messagesHistory = []; }
}

if (fs.existsSync(USERS_FILE)) {
    try { usersDatabase = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } 
    catch (e) { usersDatabase = {}; }
}

function saveHistory() {
    fs.writeFile(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2), (err) => {
        if (err) console.error("Ошибка записи истории:", err);
    });
}

function saveUsers() {
    fs.writeFile(USERS_FILE, JSON.stringify(usersDatabase, null, 2), (err) => {
        if (err) console.error("Ошибка записи базы пользователей:", err);
    });
}

// РЕГИСТРАЦИЯ (Разрешены любые символы, защита от совпадений по регистру)
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    
    const keyName = username.trim().toLowerCase();
    if (usersDatabase[keyName]) {
        return res.status(400).json({ error: "Этот никнейм уже занят другим аккаунтом!" });
    }

    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    usersDatabase[keyName] = {
        id: userId,
        name: username.trim(),
        password: password.trim(),
        avatar: null
    };

    saveUsers();
    res.json({ success: true, userId, name: username.trim(), avatar: null });
});

// ВХОД В АККАУНТ
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });

    const keyName = username.trim().toLowerCase();
    const user = usersDatabase[keyName];

    if (!user || user.password !== password.trim()) {
        return res.status(400).json({ error: "Неверный никнейм или пароль" });
    }

    res.json({ success: true, userId: user.id, name: user.name, avatar: user.avatar });
});

// ПОИСК ПОЛЬЗОВАТЕЛЯ ПО НИКУ (Ищет среди всех зарегистрированных, даже если они офлайн)
app.get('/search-user', (req, res) => {
    const query = req.query.username;
    if (!query) return res.json([]);

    const searchStr = query.trim().toLowerCase();
    const results = [];

    Object.keys(usersDatabase).forEach(key => {
        if (key.includes(searchStr)) {
            const u = usersDatabase[key];
            results.push({ id: u.id, name: u.name, avatar: u.avatar });
        }
    });

    res.json(results);
});

// ОБНОВЛЕНИЕ АВАТАРКИ
app.post('/avatar', (req, res) => {
    const { userId, avatarData } = req.body;
    if (!userId || !avatarData) return res.status(400).json({ error: "Данные не полны" });

    let found = false;
    Object.keys(usersDatabase).forEach(key => {
        if (usersDatabase[key].id === userId) {
            usersDatabase[key].avatar = avatarData;
            found = true;
        }
    });

    if (found) {
        saveUsers();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Пользователь не найден" });
    }
});

// ПИНГ СЕТИ
app.post('/ping', (req, res) => {
    const { userId, name } = req.body;
    if (userId && name) {
        let currentAvatar = null;
        Object.keys(usersDatabase).forEach(key => {
            if (usersDatabase[key].id === userId) currentAvatar = usersDatabase[key].avatar;
        });

        activeUsers[userId] = { name, avatar: currentAvatar, lastSeen: Date.now() };
    }
    
    const now = Date.now();
    Object.keys(activeUsers).forEach(id => {
        if (now - activeUsers[id].lastSeen > 8000) delete activeUsers[id];
    });
    res.json(activeUsers);
});

// ИСТОРИЯ КОНКРЕТНОГО ДИАЛОГА
app.get('/history', (req, res) => {
    const { senderId, receiverId } = req.query;
    
    const chatLog = messagesHistory.filter(msg => {
        if (receiverId === 'favorites') {
            return msg.receiverId === 'favorites' && msg.senderId === senderId;
        }
        return (msg.senderId === senderId && msg.receiverId === receiverId) ||
               (msg.senderId === receiverId && msg.receiverId === senderId);
    });
    
    res.json(chatLog);
});

// НОВОЕ СООБЩЕНИЕ
app.post('/message', (req, res) => {
    const data = req.body;
    if (data && data.senderId && data.receiverId && (data.text || data.file)) {
        messagesHistory.push(data);
        if (messagesHistory.length > 50) messagesHistory.shift();
        saveHistory();
        res.json(data);
    } else {
        res.status(400).json({ error: "Неверный формат" });
    }
});

// УДAЛЕНИЕ СООБЩЕНИЯ
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
server.listen(PORT, () => console.log(`Сервер мессенджера 4.5 запущен на порту ${PORT}`));
