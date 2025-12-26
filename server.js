require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch'); // Для загрузки CSV

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

const pendingLogins = {};
let botUsername = '';

// --- НАСТРОЙКА CORS ---
const allowedOrigins = [
    'https://рыбоедвыборг.рф',
    'https://xn--90aacfcf6delh7if.xn--p1ai'
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- НАСТРОЙКА ТЕЛЕГРАМ БОТА ---
bot.telegram.getMe().then((botInfo) => {
    botUsername = botInfo.username;
    console.log(`✅ Бот @${botUsername} готов к работе.`);
});

bot.start((ctx) => {
    const payload = ctx.startPayload;
    if (payload && pendingLogins[payload]) {
        pendingLogins[payload] = {
            status: 'success',
            user: {
                id: ctx.from.id,
                first_name: ctx.from.first_name,
                username: ctx.from.username
            }
        };
        return ctx.reply(`✅ Авторизация успешна!\nПривет, ${ctx.from.first_name}. Вернитесь на сайт.`);
    }
    ctx.reply(`Добро пожаловать в магазин "РыбоедЪ"! 🐟\nВаш ID: ${ctx.from.id}`);
});

(async () => {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
    console.log('🤖 Бот запущен (polling mode)');
  } catch (err) {
    console.error('❌ Ошибка запуска бота:', err);
  }
})();

// --- API: АВТОРИЗАЦИЯ ---
app.get('/api/auth/init', (req, res) => {
    const code = crypto.randomBytes(4).toString('hex');
    pendingLogins[code] = { status: 'pending' };
    const botLink = `https://t.me/${botUsername}?start=${code}`;
    res.json({ code, botLink });
});

app.get('/api/auth/poll', (req, res) => {
    const { code } = req.query;
    const session = pendingLogins[code];
    if (!session) return res.json({ success: false, error: 'Expired' });
    if (session.status === 'success') {
        const userData = session.user;
        delete pendingLogins[code];
        return res.json({ success: true, user: userData });
    }
    res.json({ success: false, status: 'pending' });
});

// --- ДОБАВЛЕННЫЙ КОД: ПОЛУЧЕНИЕ ТОВАРОВ ИЗ GOOGLE SHEETS ---

/**
 * Простой парсер CSV в JSON массив объектов
 * @param {string} csvText 
 * @returns {Array<Object>}
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = values[index] ? values[index].trim() : "";
        });
        return obj;
    });
}

app.get('/api/products', async (req, res) => {
    const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vReYjI3IL_ejOLztXpQErrzmyoziDQByRbvO2MJrTfOtz_1CW_Yh345u5QbNB2J-1Ekvgy8XIueofsx/pub?gid=0&single=true&output=csv';

    try {
        const response = await fetch(CSV_URL);
        if (!response.ok) throw new Error('Ошибка загрузки CSV из Google Sheets');
        
        const csvData = await response.text();
        const jsonData = parseCSV(csvData);
        
        res.json(jsonData);
    } catch (error) {
        console.error('❌ Ошибка API /api/products:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось загрузить данные товаров' });
    }
});

// --- КОНЕЦ ДОБАВЛЕННОГО КОДА ---

// --- API: ЗАКАЗЫ (ИСПРАВЛЕННЫЙ БЛОК) ---
app.post('/api/order', async (req, res) => {
    const { cart, contacts } = req.body;
    if (!cart || !contacts) return res.status(400).json({ error: 'Нет данных' });

    let message = `<b>🎣 Новый заказ "РыбоедЪ"!</b>\n\n`;
    message += `👤 <b>Клиент:</b> ${contacts.name}\n`;
    if (contacts.telegram_id) message += `🔗 <b>Профиль:</b> <a href="tg://user?id=${contacts.telegram_id}">Открыть чат</a>\n`;
    message += `📞 <b>Телефон:</b> ${contacts.phone}\n`;
    if (contacts.address) message += `📍 <b>Адрес:</b> ${contacts.address}\n`;
    message += `\n🛒 <b>Состав:</b>\n`;
    
    let totalSum = 0;
    cart.forEach((item, index) => {
        const sum = item.price * item.quantity;
        totalSum += sum;
        message += `${index + 1}. ${item.name} (x${item.quantity}) — ${sum} ₽\n`;
    });
    message += `\n💰 <b>ИТОГО: ${totalSum} ₽</b>`;

    try {
        const adminIds = process.env.ADMIN_ID ? process.env.ADMIN_ID.split(',') : [];
        
        for (const id of adminIds) {
            const trimmedId = id.trim();
            if (trimmedId) {
                try {
                    await bot.telegram.sendMessage(trimmedId, message, { parse_mode: 'HTML' });
                } catch (tgErr) {
                    console.error(`⚠️ Не удалось отправить админу ${trimmedId}:`, tgErr.message);
                }
            }
        }
        
        console.log(`✅ Обработка заказа для ${contacts.name} завершена.`);
        return res.json({ success: true });

    } catch (error) {
        console.error('❌ Критическая ошибка сервера:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
        }
    }
});

app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
