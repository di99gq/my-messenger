const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json({ limit: '50mb' }));

// CORS
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
let usersDatabase = {}; 
let onlineUsersMap = new Map();

// Чтение файлов
if (fs.existsSync(HISTORY_FILE)) {
    try { messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}
}
if (fs.existsSync(USERS_FILE)) {
    try { usersDatabase = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}

function saveHistory() { 
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2)); } catch (e) {}
}
function saveUsers() { 
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDatabase, null, 2)); } catch (e) {}
}

// РЕГИСТРАЦИЯ (с проверкой уникальности)
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    
    const keyName = username.trim().toLowerCase();
    
    // ⚠️ Проверка: ник уже занят?
    if (usersDatabase[keyName]) {
        return res.status(400).json({ error: "Этот никнейм уже занят! Выбери другой." });
    }

    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    usersDatabase[keyName] = { 
        id: userId, 
        name: username.trim(), 
        password: password.trim(), 
        avatar: null 
    };
    saveUsers();

    io.emit('user_registered', { id: userId, name: username.trim(), avatar: null });
    res.json({ success: true, userId, name: username.trim(), avatar: null });
});

// ВХОД
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const keyName = username.trim().toLowerCase();
    const user = usersDatabase[keyName];

    if (!user || user.password !== password.trim()) {
        return res.status(400).json({ error: "Неверный никнейм или пароль" });
    }
    res.json({ success: true, userId: user.id, name: user.name, avatar: user.avatar });
});

// ПОЛУЧЕНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
app.get('/users', (req, res) => {
    const list = Object.values(usersDatabase).map(u => ({ id: u.id, name: u.name, avatar: u.avatar || null }));
    res.json(list);
});

// ИСТОРИЯ СООБЩЕНИЙ
app.get('/history', (req, res) => {
    const { senderId, receiverId } = req.query;
    const log = messagesHistory.filter(msg => {
        if (receiverId === 'favorites') return msg.receiverId === 'favorites' && msg.senderId === senderId;
        return (msg.senderId === senderId && msg.receiverId === receiverId) || (msg.senderId === receiverId && msg.receiverId === senderId);
    });
    res.json(log);
});

// ОБНОВЛЕНИЕ АВАТАРКИ
app.post('/avatar', (req, res) => {
    const { userId, avatarData } = req.body;
    if (!userId || !avatarData) return res.status(400).json({ error: "Недостаточно данных" });
    
    Object.keys(usersDatabase).forEach(key => {
        if (usersDatabase[key].id === userId) usersDatabase[key].avatar = avatarData;
    });
    saveUsers();
    io.emit('avatar_updated', { userId, avatar: avatarData });
    res.json({ success: true });
});

// УДАЛЕНИЕ СООБЩЕНИЯ
app.delete('/message/:id', (req, res) => {
    messagesHistory = messagesHistory.filter(msg => String(msg.id) !== String(req.params.id));
    saveHistory();
    io.emit('message_deleted', req.params.id);
    res.json({ success: true });
});

// SOCKET.IO
io.on('connection', (socket) => {
    console.log('Подключение:', socket.id);
    
    socket.on('iam_online', (userId) => {
        if (!userId) return;
        socket.userId = userId;
        onlineUsersMap.set(userId, socket.id);
        io.emit('online_list', Array.from(onlineUsersMap.keys()));
    });

    socket.on('send_message', (msgData) => {
        if (!msgData || !msgData.senderId || !msgData.receiverId) return;
        
        msgData.timestamp = Date.now();
        if (!msgData.id) msgData.id = 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5);
        
        messagesHistory.push(msgData);
        if (messagesHistory.length > 100) messagesHistory.shift();
        saveHistory();

        socket.emit('new_message', msgData);

        if (msgData.receiverId !== 'favorites') {
            const receiverSocketId = onlineUsersMap.get(msgData.receiverId);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('new_message', msgData);
            }
        }
        
        console.log('Сообщение отправлено:', msgData.senderId, '->', msgData.receiverId);
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsersMap.delete(socket.userId);
            io.emit('online_list', Array.from(onlineUsersMap.keys()));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на ${PORT}`));