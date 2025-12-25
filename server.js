require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto'); // Встроенная библиотека для генерации случайных кодов

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

// Хранилище сессий в памяти
// Структура: { 'код_сессии': { status: 'pending' | 'success', user: {...} } }
const pendingLogins = {};

// Переменная для хранения имени бота (нужна для генерации ссылки)
let botUsername = '';

// --- НАСТРОЙКА EXPRESS ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- НАСТРОЙКА TELEGRAM БОТА ---

// 1. Получаем имя бота при запуске
bot.telegram.getMe().then((botInfo) => {
    botUsername = botInfo.username;
    console.log(`✅ Бот @${botUsername} инициализирован и готов к работе.`);
});

// 2. Обработка команды /start
bot.start((ctx) => {
    const payload = ctx.startPayload; // То, что идет после ?start=...

    // Сценарий А: Авторизация на сайте (Deep Linking)
    if (payload && pendingLogins[payload]) {
        // Записываем данные пользователя в сессию
        pendingLogins[payload] = {
            status: 'success',
            user: {
                id: ctx.from.id,
                first_name: ctx.from.first_name,
                username: ctx.from.username,
                photo_url: null // Телеграм не отдает ссылку на фото просто так
            }
        };

        return ctx.reply(`✅ Авторизация успешна!\nПривет, ${ctx.from.first_name}. Можете возвращаться на сайт.`);
    }

    // Сценарий Б: Обычный запуск (просто нажали /start)
    ctx.reply(`Добро пожаловать в магазин "РыбоедЪ"! 🐟\nВаш ID: ${ctx.from.id}`);
});

// Запуск бота
bot.launch().then(() => console.log('🤖 Бот запущен'));


// --- API: АВТОРИЗАЦИЯ ---

// Шаг 1: Фронтенд просит начать вход
app.get('/api/auth/init', (req, res) => {
    // Генерируем случайный код (например, "a1b2c3d4")
    const code = crypto.randomBytes(4).toString('hex');
    
    // Сохраняем во временное хранилище
    pendingLogins[code] = { status: 'pending' };

    // Формируем ссылку на бота
    // Пример: https://t.me/RyboedBot?start=a1b2c3d4
    const botLink = `https://t.me/${botUsername}?start=${code}`;

    res.json({ code, botLink });
});

// Шаг 2: Фронтенд опрашивает сервер (Polling)
app.get('/api/auth/poll', (req, res) => {
    const { code } = req.query;
    const session = pendingLogins[code];

    // Если код не найден или просрочен
    if (!session) {
        return res.json({ success: false, error: 'Session expired' });
    }

    // Если пользователь уже нажал Start в боте
    if (session.status === 'success') {
        const userData = session.user;
        delete pendingLogins[code]; // Удаляем сессию, чтобы нельзя было использовать повторно
        return res.json({ success: true, user: userData });
    }

    // Если пользователь еще не нажал
    res.json({ success: false, status: 'pending' });
});


// --- API: ЗАКАЗЫ (Твоя старая логика) ---

app.post('/api/order', async (req, res) => {
    const { cart, contacts } = req.body;
    if (!cart || !contacts) return res.status(400).json({ error: 'Нет данных' });

    let message = `<b>🎣 Новый заказ "РыбоедЪ"!</b>\n\n`;
    message += `👤 <b>Клиент:</b> ${contacts.name}\n`;
    
    // Если есть Telegram ID (из новой авторизации), делаем ссылку
    if (contacts.telegram_id) {
        message += `🔗 <b>Профиль:</b> <a href="tg://user?id=${contacts.telegram_id}">Открыть чат</a>\n`;
    }

    message += `📞 <b>Телефон:</b> ${contacts.phone}\n`;
    if (contacts.address) message += `📍 <b>Адрес:</b> ${contacts.address}\n`;
    
    message += `\n🛒 <b>Состав заказа:</b>\n`;
    
    let totalSum = 0;
    cart.forEach((item, index) => {
        const sum = item.price * item.quantity;
        totalSum += sum;
        message += `${index + 1}. ${item.name} (x${item.quantity}) — ${sum} ₽\n`;
    });
    message += `\n💰 <b>ИТОГО: ${totalSum} ₽</b>`;

    try {
        const adminIds = process.env.ADMIN_ID.split(',');
        for (const id of adminIds) {
            if (id.trim()) await bot.telegram.sendMessage(id.trim(), message, { parse_mode: 'HTML' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

// Запуск сервера
app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));

// Остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));