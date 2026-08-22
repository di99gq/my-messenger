const express = require('express');
const http = require('http');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Включаем поддержку JSON
app.use(express.json());

// Настройка CORS для работы с любыми фронтенд-клиентами
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); 
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const HISTORY_FILE = 'chat-history.json';
let messagesHistory = [];

// Чтение истории при старте (допускается синхронно, так как выполняется один раз)
if (fs.existsSync(HISTORY_FILE)) {
  try {
    messagesHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    messagesHistory = [];
  }
}

// Эндпоинт для получения истории сообщений
app.get('/history', (req, res) => {
  res.json(messagesHistory);
});

// Эндпоинт для отправки нового сообщения
app.post('/message', (req, res) => {
  const data = req.body;
  
  if (data && data.name && data.text) {
    messagesHistory.push(data);
    
    // ЗАМЕЧАНИЕ 2: Ограничиваем историю 100 сообщениями, чтобы сервер не падал от переполнения памяти
    if (messagesHistory.length > 100) {
      messagesHistory.shift();
    }

    // ЗАМЕЧАНИЕ 1: Асинхронная запись в файл, которая не блокирует работу чата для других пользователей
    fs.writeFile(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2), (err) => {
      if (err) {
        console.error("Ошибка записи файла истории:", err);
      }
    });

    res.json(data);
  } else {
    res.status(400).json({ error: "Неверный формат" });
  }
});

// КРИТИЧЕСКОЕ ЗАМЕЧАНИЕ: Динамический порт (process.env.PORT) для успешного деплоя на хостинг Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
