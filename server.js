const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } 
});

const HISTORY_FILE = 'chat-history.json';
let messagesHistory = [];

if (fs.existsSync(HISTORY_FILE)) {
  try {
    messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    messagesHistory = [];
  }
}

io.on('connection', (socket) => {
  socket.emit('history', messagesHistory);

  socket.on('message', (data) => {
    messagesHistory.push(data);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2));
    io.emit('message', data);
  });
});

server.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});
