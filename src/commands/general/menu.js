import settings from '../../src/settings.json' with { type: 'json' };
import { applyFont, getRandom } from '../../lib/functions.js';

const command = {
    name: "menu",
    aliases: ["help", "commands"],
    description: "Muestra el menú de comandos del bot.",
    usage: "menu",

    async execute(m, { conn, commands }) {
        const botNameStyled = applyFont(settings.bot.botname, 'styledLetters');
        const ownerNameStyled = applyFont(settings.owner.name, 'smallLetters');

        let menuText = `•——————•°•✿•°•——————•\n`;
        menuText += `╰┈➤ ${botNameStyled} ⌇°•\n`;
        menuText += `⊱┊ ᴴᵉᶜʰᵒ ᵖᵒʳ ${ownerNameStyled}\n\n`;

        const commandsByCategory = {};

        for (const [key, value] of commands) {
            if (!commandsByCategory[value.category]) {
                commandsByCategory[value.category] = [];
            }
            commandsByCategory[value.category].push(value.name);
        }

        for (const category in commandsByCategory) {
            const categoryStyled = applyFont(category, 'styledLetters');
            menuText += `ೃ‧₊› ${categoryStyled} ：\n`;
            commandsByCategory[category].forEach(commandName => {
                menuText += `       ╰┈➤ ${settings.bot.prefixes[0]}${commandName}\n`;
            });
            menuText += `\n↶*ೃ✧˚. ❃ ↷ ˊ-↶*ೃ✧˚. ❃ ↷ ˊ-\n\n`;
        }

        const adReply = {
            text: menuText.trim(),
            contextInfo: {
                externalAdReply: {
                    title: settings.channel.name,
                    body: `Desarrollado por ${settings.owner.name}`,
                    thumbnailUrl: getRandom(settings.branding.bannerUrl),
                    sourceUrl: `https://whatsapp.com/channel/${settings.channel.id.split('@')[0]}`,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        };

        await conn.sendMessage(m.chat, adReply, { quoted: m });
    }
};

export default command;
