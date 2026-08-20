const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Говорим серверу показать файл index.html, когда кто-то заходит на сайт
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Слушаем подключения от пользователей
io.on('connection', (socket) => {
    console.log('Кто-то подключился к чату!');

    // Когда сервер получает сообщение 'chat message', он пересылает его ВСЕМ
    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    // Когда пользователь закрывает вкладку
    socket.on('disconnect', () => {
        console.log('Пользователь ушел из чата');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('Сервер успешно запущен на порту ' + PORT);
});

