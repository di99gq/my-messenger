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
let usersDatabase = {}; 
let activeUsers = {};   // Онлайн-пользователи
let activeCalls = {};   // Текущие звонки в процессе { callId: { from, to, type, status, timestamp, sdp, ice } }

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

// РЕГИСТРАЦИЯ
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
// ПОИСК ПОЛЬЗОВАТЕЛЯ ПО НИКУ
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

// ИНИЦИАЛИЗАЦИЯ ЗВОНКА (Вызывающий начинает гудки)
app.post('/call/init', (req, res) => {
    const { fromId, toId, callType, sdp } = req.body;
    if (!fromId || !toId || !callType) return res.status(400).json({ error: "Неполные данные вызова" });

    const callId = 'call_' + Date.now();
    activeCalls[callId] = {
        id: callId,
        from: fromId,
        to: toId,
        type: callType, // 'audio' или 'video'
        status: 'ringing', // ringing, answered, ended
        timestamp: Date.now(),
        offerSdp: sdp,
        answerSdp: null,
        iceCandidates: []
    };
    res.json(activeCalls[callId]);
});

// ОТВЕТ НА ЗВОНОК (Собеседник поднял трубку)
app.post('/call/answer', (req, res) => {
    const { callId, sdp } = req.body;
    const call = activeCalls[callId];
    if (!call) return res.status(404).json({ error: "Звонок не найден" });

    call.status = 'answered';
    call.answerSdp = sdp;
    res.json({ success: true });
});

//ОБМЕН ICE-КАНДИДАТАМИ ДЛЯ WebRTC
app.post('/call/ice', (req, res) => {
    const { callId, candidate } = req.body;
    const call = activeCalls[callId];
    if (!call) return res.status(404).json({ error: "Звонок не найден" });

    if (candidate) call.iceCandidates.push(candidate);
    res.json({ success: true });
});
// ЗАВЕРШЕНИЕ ИЛИ СБРОС ЗВОНКА В ЛЮБУЮ СЕКУНДУ
app.post('/call/end', (req, res) => {
    const { callId, reason, senderName } = req.body;
    const call = activeCalls[callId];
    if (call) {
        call.status = 'ended';
        
        // Автоматически логируем системное сообщение в чат в зависимости от причины сброса
        let logText = "📞 Звонок завершен";
        if (reason === 'rejected') logText = "❌ Звонок отклонен";
        if (reason === 'cancelled') logText = "🛑 Звонок отменен";

        const systemMsg = {
            id: 'sys_' + Date.now() + Math.random().toString(36).substr(2, 5),
            name: "Система",
            senderId: call.from,
            receiverId: call.to,
            text: `${logText} (${call.type === 'video' ? 'Видео' : 'Аудио'})`,
            timestamp: Date.now()
        };
        messagesHistory.push(systemMsg);
        if (messagesHistory.length > 50) messagesHistory.shift();
        saveHistory();
        
        delete activeCalls[callId];
    }
    res.json({ success: true });
});

// ПИНГ СЕТИ + ТАЙМАУТ ЗВОНКОВ (15 СЕКУНД ГУДКОВ)
app.post('/ping', (req, res) => {
    const { userId, name } = req.body;
    const now = Date.now();

    if (userId && name) {
        let currentAvatar = null;
        Object.keys(usersDatabase).forEach(key => {
            if (usersDatabase[key].id === userId) currentAvatar = usersDatabase[key].avatar;
        });
        activeUsers[userId] = { name, avatar: currentAvatar, lastSeen: now };
    }
    
    // Проверка онлайна (8 секунд отсутствия — офлайн)
    Object.keys(activeUsers).forEach(id => {
        if (now - activeUsers[id].lastSeen > 8000) delete activeUsers[id];
    });

    // Проверка таймаута звонков (15 секунд гудков)
    Object.keys(activeCalls).forEach(callId => {
        const call = activeCalls[callId];
        if (call.status === 'ringing' && (now - call.timestamp > 15000)) {
            call.status = 'ended';

            // Создаем системное сообщение о пропущенном вызове
            const missedMsg = {
                id: 'sys_' + Date.now() + Math.random().toString(36).substr(2, 5),
                name: "Система",
                senderId: call.from,
                receiverId: call.to,
                text: `❌ Пропущенный вызов (${call.type === 'video' ? 'Видео' : 'Аудио'})`,
                timestamp: now
            };
            messagesHistory.push(missedMsg);
            if (messagesHistory.length > 50) messagesHistory.shift();
            saveHistory();

            delete activeCalls[callId];
        }
    });

    // Возвращаем клиенту список юзеров и текущие звонки для его ID
    const myCalls = Object.values(activeCalls).filter(c => c.from === userId || c.to === userId);
    res.json({ onlineUsers, activeCalls: myCalls });
});

// НОВОЕ СООБЩЕНИЕ В ЧАТ С ФИКСАЦИЕЙ ВРЕМЕНИ
app.post('/message', (req, res) => {
    const data = req.body;
    if (data && data.senderId && data.receiverId && (data.text || data.file)) {
        data.timestamp = Date.now(); // Жестко фиксируем время на сервере
        messagesHistory.push(data);
        if (messagesHistory.length > 50) messagesHistory.shift();
        saveHistory();
        res.json(data);
    } else {
        res.status(400).json({ error: "Неверный формат" });
    }
});

// УДАЛЕНИЕ СООБЩЕНИЯ
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
server.listen(PORT, () => console.log(`Сервер мессенджера 5.5 (Звонки и Время) запущен на порту ${PORT}`));
