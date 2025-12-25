require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;

// Хранилище временных сессий для авторизации
const pendingLogins = {};
let botUsername = '';

// --- 1. НАСТРОЙКА CORS (Разрешаем запросы только с твоего домена) ---
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

// --- 2. ЛОГИКА ТЕЛЕГРАМ БОТА ---

// Получаем имя бота для ссылок
bot.telegram.getMe().then((botInfo) => {
    botUsername = botInfo.username;
    console.log(`✅ Бот @${botUsername} готов к работе.`);
});

// Новое приветствие с поддержкой Mini App и авторизации
bot.start((ctx) => {
    const payload = ctx.startPayload; // Код авторизации
    const firstName = ctx.from.first_name || 'гость';

    // Сценарий А: Авторизация через сайт (Deep Linking)
    if (payload && pendingLogins[payload]) {
        pendingLogins[payload] = {
            status: 'success',
            user: {
                id: ctx.from.id,
                first_name: ctx.from.first_name,
                username: ctx.from.username
            }
        };

        return ctx.replyWithHTML(
            `<b>🤝 С возвращением, ${firstName}!</b>\n\n` +
            `Вы успешно подтвердили вход в магазин <b>"РыбоедЪ"</b>.\n` +
            `Теперь вернитесь на сайт — ваш профиль уже готов к заказу. 🐟`
        );
    }

    // Сценарий Б: Обычный запуск бота
    ctx.replyWithHTML(
        `<b>Приветствуем в "РыбоедЪ", ${firstName}! 🎣</b>\n\n` +
        `Здесь самые свежие морепродукты и деликатесы с доставкой прямо к вашему столу.\n\n` +
        `🛒 <b>Наш сайт:</b> <a href="https://рыбоедвыборг.рф">рыбоедвыборг.рф</a>\n` +
        `📍 <b>Выборг:</b> доставка и самовывоз.\n\n` +
        `<i>Нажмите на кнопку ниже, чтобы открыть магазин прямо здесь!</i>`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🛍 Открыть магазин", web_app: { url: "https://рыбоедвыборг.рф" } }]
                ]
            }
        }
    );
});

// Безопасный запуск бота (сброс старых вебхуков)
(async () => {
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await bot.launch();
        console.log('🤖 Бот запущен в режиме Long Polling');
    } catch (err) {
        console.error('❌ Ошибка запуска бота:', err);
    }
})();

// --- 3. API ЭНДПОИНТЫ ---

// Инициализация входа
app.get('/api/auth/init', (req, res) => {
    const code = crypto.randomBytes(4).toString('hex');
    pendingLogins[code] = { status: 'pending' };
    const botLink = `https://t.me/${botUsername}?start=${code}`;
    res.json({ code, botLink });
});

// Проверка статуса входа (Polling)
app.get('/api/auth/poll', (req, res) => {
    const { code } = req.query;
    const session = pendingLogins[code];
    if (!session) return res.json({ success: false, error: 'Сессия истекла' });
    
    if (session.status === 'success') {
        const userData = session.user;
        delete pendingLogins[code]; // Удаляем после успешного входа
        return res.json({ success: true, user: userData });
    }
    res.json({ success: false, status: 'pending' });
});

// Прием заказов
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
        
        console.log(`✅ Заказ для ${contacts.name} успешно обработан.`);
        return res.json({ success: true });

    } catch (error) {
        console.error('❌ Критическая ошибка при обработке заказа:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    }
});

// --- 4. ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

// Корректное завершение работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
