const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Подключаем Socket.io с поддержкой CORS
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json({ limit: '50mb' }));

// CORS заголовки для обычных HTTP запросов
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
let onlineUsersMap = new Map(); // Хранилище активных socket.id -> userId

// Загрузка данных с диска
if (fs.existsSync(HISTORY_FILE)) {
    try { messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}
}
if (fs.existsSync(USERS_FILE)) {
    try { usersDatabase = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}

function saveHistory() { fs.writeFileSync(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2)); }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDatabase, null, 2)); }

// HTTP Эндпоинты: Регистрация и Вход
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    
    const keyName = username.trim().toLowerCase();
    if (usersDatabase[keyName]) return res.status(400).json({ error: "Никнейм занят!" });

    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    usersDatabase[keyName] = { id: userId, name: username.trim(), password: password.trim(), avatar: null };
    saveUsers();

    // Оповещаем все подключенные браузеры о новом пользователе
    io.emit('user_registered', { id: userId, name: username.trim(), avatar: null });
    res.json({ success: true, userId, name: username.trim(), avatar: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const keyName = username.trim().toLowerCase();
    const user = usersDatabase[keyName];

    if (!user || user.password !== password.trim()) {
        return res.status(400).json({ error: "Неверный никнейм или пароль" });
    }
    res.json({ success: true, userId: user.id, name: user.name, avatar: user.avatar });
});

app.get('/users', (req, res) => {
    const list = Object.values(usersDatabase).map(u => ({ id: u.id, name: u.name, avatar: u.avatar || null }));
    res.json(list);
});

app.get('/history', (req, res) => {
    const { senderId, receiverId } = req.query;
    const log = messagesHistory.filter(msg => {
        if (receiverId === 'favorites') return msg.receiverId === 'favorites' && msg.senderId === senderId;
        return (msg.senderId === senderId && msg.receiverId === receiverId) || (msg.senderId === receiverId && msg.receiverId === senderId);
    });
    res.json(log);
});

app.post('/avatar', (req, res) => {
    const { userId, avatarData } = req.body;
    Object.keys(usersDatabase).forEach(key => {
        if (usersDatabase[key].id === userId) usersDatabase[key].avatar = avatarData;
    });
    saveUsers();
    io.emit('avatar_updated', { userId, avatar: avatarData });
    res.json({ success: true });
});

app.delete('/message/:id', (req, res) => {
    messagesHistory = messagesHistory.filter(msg => String(msg.id) !== String(req.params.id));
    saveHistory();
    io.emit('message_deleted', req.params.id);
    res.json({ success: true });
});

// Логика Живого Соединения WebSockets
io.on('connection', (socket) => {
    
    // Когда пользователь объявляет свой ID при старте страницы
    socket.on('iam_online', (userId) => {
        socket.userId = userId;
        onlineUsersMap.set(userId, socket.id);
        // Отправляем всем список тех, кто онлайн прямо сейчас
        io.emit('online_list', Array.from(onlineUsersMap.keys()));
    });

    // Обработка отправки сообщения
    socket.on('send_message', (msgData) => {
        msgData.timestamp = Date.now();
        messagesHistory.push(msgData);
        if (messagesHistory.length > 100) messagesHistory.shift();
        saveHistory();

        // Отправляем сообщение обратно отправителю
        socket.emit('new_message', msgData);

        // Отправляем получателю (если он онлайн)
        if (msgData.receiverId === 'favorites') return;
        const receiverSocketId = onlineUsersMap.get(msgData.receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('new_message', msgData);
        }
    });

    // WebRTC Сигналинг звонков через сокеты (Мгновенно, без задержек)
    socket.on('call_init', (data) => {
        const targetSocketId = onlineUsersMap.get(data.toId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', {
                callId: data.callId,
                fromId: data.fromId,
                fromName: data.fromName,
                callType: data.callType,
                sdp: data.sdp
            });
        }
    });

    socket.on('call_answer', (data) => {
        const targetSocketId = onlineUsersMap.get(data.toId);
        if (targetSocketId) io.to(targetSocketId).emit('call_answered', { sdp: data.sdp });
    });

    socket.on('call_ice', (data) => {
        const targetSocketId = onlineUsersMap.get(data.toId);
        if (targetSocketId) io.to(targetSocketId).emit('call_ice_candidate', { candidate: data.candidate });
    });

    socket.on('call_end', (data) => {
        const targetSocketId = onlineUsersMap.get(data.toId);
        if (targetSocketId) io.to(targetSocketId).emit('call_ended');
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsersMap.delete(socket.userId);
            io.emit('online_list', Array.from(onlineUsersMap.keys()));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Профессиональный Socket-сервер запущен на порту ${PORT}`));
