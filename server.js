require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto');

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

// --- API: ЗАКАЗЫ (ИСПРАВЛЕННЫЙ БЛОК) ---
app.post('/api/order', async (req, res) => {
    const { cart, contacts } = req.body;
    if (!cart || !contacts) return res.status(400).json({ error: 'Нет данных' });

    // Формируем текст сообщения
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
        // 1. Рассылка админам (каждому по отдельности)
        const adminIds = process.env.ADMIN_ID ? process.env.ADMIN_ID.split(',') : [];
        
        for (const id of adminIds) {
            const trimmedId = id.trim();
            if (trimmedId) {
                try {
                    // Оборачиваем отправку конкретному человеку
                    await bot.telegram.sendMessage(trimmedId, message, { parse_mode: 'HTML' });
                } catch (tgErr) {
                    // Если один админ забанил бота, сервер просто запишет ошибку в лог и пойдет дальше
                    console.error(`⚠️ Не удалось отправить админу ${trimmedId}:`, tgErr.message);
                }
            }
        }
        
        // 2. ОТВЕТ САЙТУ (теперь он сработает всегда после цикла)
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