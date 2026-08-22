const express = require('express');
const http = require('http');
const fs = require('fs');
const compression = require('compression'); // Сжатие трафика

const app = express();
const server = http.createServer(app);

// Включаем сжатие ответов сервера (Gzip)
app.use(compression());

// Лимит 50мб для Base64 файлов
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  // Добавлено: разрешаем метод DELETE
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
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

app.get('/history', (req, res) => {
  res.json(messagesHistory);
});

app.post('/message', (req, res) => {
  const data = req.body;
  
  if (data && data.name && (data.text || data.file)) {
    messagesHistory.push(data);
    
    if (messagesHistory.length > 30) {
      messagesHistory.shift();
    }

    fs.writeFile(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2), (err) => {
      if (err) console.error("Ошибка записи файла истории:", err);
    });
    
    res.json(data);
  } else {
    res.status(400).json({ error: "Неверный формат данных" });
  }
});

// Добавлено: эндпоинт для удаления сообщения по ID
app.delete('/message/:id', (req, res) => {
  const messageId = req.params.id;
  const initialLength = messagesHistory.length;
  
  // Оставляем в истории только те сообщения, у которых ID не совпадает с удаляемым
  messagesHistory = messagesHistory.filter(msg => String(msg.id) !== String(messageId));

  if (messagesHistory.length !== initialLength) {
    fs.writeFile(HISTORY_FILE, JSON.stringify(messagesHistory, null, 2), (err) => {
      if (err) console.error("Ошибка записи файла истории:", err);
    });
    res.json({ success: true, id: messageId });
  } else {
    res.status(404).json({ error: "Сообщение не найдено" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
