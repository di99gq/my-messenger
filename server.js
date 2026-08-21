const express = require('express');
const http = require('http');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Разрешаем Hugging Face обмениваться данными с сервером
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
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

// Отдаем историю сообщений
app.get('/history', (req, res) => {
  res.json(messagesHistory);
});

// Принимаем новое сообщение
app.post('/message', (req, res) => {
  const data = req.body;
  if (data && data.name && data.text) {
    messagesHistory.push(data);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2));
    res.json(data);
  } else {
    res.status(400).json({ error: "Неверный формат данных" });
  }
});

server.listen(3000, () => {
  console.log('Сервер успешно запущен на порту 3000');
});
