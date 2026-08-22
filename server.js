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
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const HISTORY_FILE = path.join(__dirname, 'chat-history.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');

let messagesHistory = [];
let usersDatabase = {}; 
let groupsDatabase = {}; 
let onlineUsersMap = new Map();

// Чтение файлов
if (fs.existsSync(HISTORY_FILE)) {
    try { messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}
}
if (fs.existsSync(USERS_FILE)) {
    try { usersDatabase = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}
if (fs.existsSync(GROUPS_FILE)) {
    try { groupsDatabase = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch (e) {}
}

function saveHistory() { 
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2)); } catch (e) {}
}
function saveUsers() { 
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(usersDatabase, null, 2)); } catch (e) {}
}
function saveGroups() { 
    try { fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupsDatabase, null, 2)); } catch (e) {}
}

// РЕГИСТРАЦИЯ
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    
    const keyName = username.trim().toLowerCase();
    
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

// ПОЛУЧЕНИЕ ВСЕХ ГРУПП
app.get('/groups', (req, res) => {
    const list = Object.values(groupsDatabase).map(g => ({ 
        id: g.id, 
        name: g.name, 
        avatar: g.avatar || null, 
        description: g.description || '',
        members: g.members || [],
        adminId: g.adminId
    }));
    res.json(list);
});

// СОЗДАНИЕ ГРУППЫ
app.post('/create-group', (req, res) => {
    const { name, description, avatar, adminId, members } = req.body;
    if (!name || !adminId) return res.status(400).json({ error: "Заполните название группы" });
    
    const groupId = 'group_' + Math.random().toString(36).substr(2, 9);
    groupsDatabase[groupId] = {
        id: groupId,
        name: name.trim(),
        description: description || '',
        avatar: avatar || null,
        adminId: adminId,
        members: Array.isArray(members) ? [...new Set([adminId, ...members])] : [adminId]
    };
    saveGroups();

    // Системное сообщение о создании группы
    const systemMsg = {
        id: 'sys_' + Date.now() + Math.random().toString(36).substr(2, 5),
        senderId: 'system',
        receiverId: groupId,
        text: `Группа "${name.trim()}" создана`,
        timestamp: Date.now(),
        system: true
    };
    messagesHistory.push(systemMsg);
    saveHistory();

    // Отправляем всем участникам
    groupsDatabase[groupId].members.forEach(userId => {
        const userSocketId = onlineUsersMap.get(userId);
        if (userSocketId) {
            io.to(userSocketId).emit('new_message', systemMsg);
        }
    });

    io.emit('group_created', { id: groupId, name: name.trim(), description: description || '', avatar: avatar || null, members: groupsDatabase[groupId].members });
    res.json({ success: true, groupId, name: name.trim() });
});

// ДОБАВЛЕНИЕ УЧАСТНИКА В ГРУППУ
app.post('/group/:id/members', (req, res) => {
    const { userId } = req.body;
    const group = groupsDatabase[req.params.id];
    
    if (!group) {
        return res.status(404).json({ error: "Группа не найдена" });
    }
    
    if (!group.members.includes(userId)) {
        group.members.push(userId);
        saveGroups();

        // Системное сообщение о добавлении участника
        const user = usersDatabase[Object.keys(usersDatabase).find(key => usersDatabase[key].id === userId)];
        const systemMsg = {
            id: 'sys_' + Date.now() + Math.random().toString(36).substr(2, 5),
            senderId: 'system',
            receiverId: group.id,
            text: `${user ? user.name : 'Пользователь'} добавлен в группу`,
            timestamp: Date.now(),
            system: true
        };
        messagesHistory.push(systemMsg);
        saveHistory();

        // Отправляем всем участникам группы
        group.members.forEach(memberId => {
            const memberSocketId = onlineUsersMap.get(memberId);
            if (memberSocketId) {
                io.to(memberSocketId).emit('new_message', systemMsg);
            }
        });

        // Отправляем новому участнику группу
        const newMemberSocketId = onlineUsersMap.get(userId);
        if (newMemberSocketId) {
            io.to(newMemberSocketId).emit('group_added_to_chat', { id: group.id, name: group.name, avatar: group.avatar });
        }

        io.emit('group_member_added', { groupId: group.id, userId: userId, members: group.members });
    }
    
    res.json({ success: true, members: group.members });
});

// УДАЛЕНИЕ УЧАСТНИКА ИЗ ГРУППЫ
app.delete('/group/:id/members/:userId', (req, res) => {
    const group = groupsDatabase[req.params.id];
    const userId = req.params.userId;
    
    if (!group) {
        return res.status(404).json({ error: "Группа не найдена" });
    }
    
    group.members = group.members.filter(u => u !== userId);
    saveGroups();

    // Системное сообщение об удалении участника
    const user = usersDatabase[Object.keys(usersDatabase).find(key => usersDatabase[key].id === userId)];
    const systemMsg = {
        id: 'sys_' + Date.now() + Math.random().toString(36).substr(2, 5),
        senderId: 'system',
        receiverId: group.id,
        text: `${user ? user.name : 'Пользователь'} удалён из группы`,
        timestamp: Date.now(),
        system: true
    };
    messagesHistory.push(systemMsg);
    saveHistory();

    // Отправляем всем участникам
    group.members.forEach(memberId => {
        const memberSocketId = onlineUsersMap.get(memberId);
        if (memberSocketId) {
            io.to(memberSocketId).emit('new_message', systemMsg);
        }
    });

    io.emit('group_member_removed', { groupId: group.id, userId: userId, members: group.members });
    res.json({ success: true, members: group.members });
});

// УДАЛЕНИЕ ГРУППЫ
app.delete('/group/:id', (req, res) => {
    delete groupsDatabase[req.params.id];
    saveGroups();
    io.emit('group_deleted', req.params.id);
    res.json({ success: true });
});

// РЕДАКТИРОВАНИЕ ГРУППЫ
app.put('/group/:id', (req, res) => {
    const { name, description, avatar } = req.body;
    const group = groupsDatabase[req.params.id];
    
    if (!group) {
        return res.status(404).json({ error: "Группа не найдена" });
    }
    
    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description;
    if (avatar !== undefined) group.avatar = avatar;
    
    saveGroups();
    io.emit('group_updated', { id: group.id, name: group.name, description: group.description, avatar: group.avatar });
    res.json({ success: true });
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

// РЕДАКТИРОВАНИЕ СООБЩЕНИЯ
app.put('/message/:id', (req, res) => {
    const { newText } = req.body;
    const msg = messagesHistory.find(m => String(m.id) === String(req.params.id));
    
    if (!msg) {
        return res.status(404).json({ error: "Сообщение не найдено" });
    }
    
    msg.text = newText;
    msg.edited = true;
    saveHistory();
    io.emit('message_edited', { id: msg.id, newText: newText, edited: true });
    res.json({ success: true });
});

// SOCKET.IO — ИСПРАВЛЕННАЯ ОТПРАВКА СООБЩЕНИЙ
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

        // Всегда отправляем автору
        socket.emit('new_message', msgData);

        // Если это группа — отправляем всем участникам группы
        if (msgData.receiverId.startsWith('group_')) {
            const group = groupsDatabase[msgData.receiverId];
            if (group) {
                group.members.forEach(memberId => {
                    if (memberId !== msgData.senderId) {
                        const memberSocketId = onlineUsersMap.get(memberId);
                        if (memberSocketId) {
                            io.to(memberSocketId).emit('new_message', msgData);
                        }
                    }
                });
            }
        } else if (msgData.receiverId !== 'favorites') {
            // Если личное сообщение — отправляем получателю
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