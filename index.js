import { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pino from 'pino';
import chokidar from 'chokidar'; // <-- Nueva dependencia para vigilar archivos
import settings from './src/settings.json' assert { type: 'json' };

const logger = pino({ level: 'silent' });

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.commands = new Map();
        this.loadCommands();
        // Inicia la vigilancia de la carpeta de comandos
        this.watchCommands();
    }

    async loadCommands() {
        const commandsPath = path.join(process.cwd(), 'src', 'commands');
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
        }

        const categoryFolders = fs.readdirSync(commandsPath);

        for (const category of categoryFolders) {
            const categoryPath = path.join(commandsPath, category);
            if (fs.lstatSync(categoryPath).isDirectory()) {
                const commandFiles = fs.readdirSync(categoryPath).filter(file => file.endsWith('.js'));
                for (const file of commandFiles) {
                    try {
                        const filePath = path.join(categoryPath, file);
                        const { default: command } = await import(`file://${filePath}?v=${Date.now()}`);
                        if (command && command.name) {
                            command.category = category;
                            this.commands.set(command.name, command);
                            if (command.aliases && Array.isArray(command.aliases)) {
                                command.aliases.forEach(alias => this.commands.set(alias, command));
                            }
                        }
                    } catch (error) {
                        console.error(`[Error] Cargando el comando ${file}:`, error);
                    }
                }
            }
        }
        console.log(`[Sistema] ${this.commands.size} comandos cargados.`);
    }

    // --- NUEVA FUNCIÓN DE VIGILANCIA (HOT-RELOAD) ---
    watchCommands() {
        const commandsPath = path.join(process.cwd(), 'src', 'commands');
        const watcher = chokidar.watch(commandsPath, {
            persistent: true,
            ignoreInitial: true,
        });

        watcher.on('change', async (filePath) => {
            if (filePath.endsWith('.js')) {
                console.log(`[Hot-Reload] Detectado cambio en: ${path.basename(filePath)}. Recargando...`);
                try {
                    // Cache-busting para asegurar que se importa el nuevo archivo
                    const { default: newCommand } = await import(`file://${filePath}?update=${Date.now()}`);
                    const category = path.basename(path.dirname(filePath));

                    if (newCommand && newCommand.name) {
                        newCommand.category = category;
                        // Sobreescribe el comando y sus alias en el mapa
                        this.commands.set(newCommand.name, newCommand);
                        if (newCommand.aliases && Array.isArray(newCommand.aliases)) {
                            newCommand.aliases.forEach(alias => this.commands.set(alias, newCommand));
                        }
                        console.log(`[Hot-Reload] Comando '${newCommand.name}' actualizado exitosamente.`);
                    }
                } catch (error) {
                    console.error(`[Hot-Reload] Fallo al recargar el comando ${path.basename(filePath)}:`, error);
                }
            }
        });
         console.log('[Sistema] Vigilancia de comandos activada (Hot-Reload).');
    }

    async getAuthMethod() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            console.log('¡Bienvenido a MayBot! Selecciona tu método de conexión:');
            console.log('1. Código QR');
            console.log('2. Número de Teléfono');
            rl.question('Selecciona una opción (1 o 2): ', (answer) => {
                rl.close();
                resolve(answer === '2' ? 'code' : 'qr');
            });
        });
    }

    async getPhoneNumber() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            rl.question('Ingresa tu número de teléfono (formato: 51987654321): ', (number) => {
                rl.close();
                resolve(number.replace(/\D/g, ''));
            });
        });
    }

    async startBot() {
        console.log(`[MayBot] Inicializando...`);
        const authMethod = await this.getAuthMethod();
        const { state, saveCreds } = await useMultiFileAuthState(settings.bot.sessionFolder);
        const { version } = await fetchLatestBaileysVersion();

        console.log(`[MayBot] Usando la versión de Baileys: ${version.join('.')}`);
        
        let phoneNumber = null;
        if (authMethod === 'code' && !state.creds.registered) {
            phoneNumber = await this.getPhoneNumber();
        }

        this.sock = makeWASocket({
            version,
            auth: state,
            logger,
            browser: [settings.bot.botname, 'Chrome', '121.0.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true,
            printQRInTerminal: authMethod === 'qr',
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && authMethod === 'qr') {
                console.log('Escanea el código QR con tu WhatsApp:');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[Conexión] cerrada debido a: ${lastDisconnect?.error}, reconectando: ${shouldReconnect}`);
                if (shouldReconnect) {
                    setTimeout(() => this.startBot(), 5000);
                }
            } else if (connection === 'open') {
                console.log('[Conexión] establecida exitosamente.');
            } else if (connection === 'connecting' && authMethod === 'code' && phoneNumber && !state.creds.registered) {
                try {
                    console.log(`[Auth] Solicitando código para el número: ${phoneNumber}`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const code = await this.sock.requestPairingCode(phoneNumber);
                    console.log(`[Auth] Tu código de emparejamiento es: ${code}`);
                } catch (error) {
                    console.error('[Auth] Fallo al solicitar el código de emparejamiento:', error);
                }
            }
        });

        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const message of messages) {
                await this.handleMessage(message);
            }
        });
    }

    async handleMessage(message) {
        if (message.key.fromMe || !message.message) return;

        const messageText = message.message.conversation || message.message.extendedTextMessage?.text || '';
        const usedPrefix = settings.bot.prefixes.find(p => messageText.startsWith(p));
        if (!usedPrefix) return;

        const args = messageText.slice(usedPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = this.commands.get(commandName);

        if (command) {
            // --- NUEVO BLOQUE DE SIMULACIÓN DE ESCRITURA ---
            await this.sock.sendPresenceUpdate('composing', message.key.remoteJid);
            try {
                console.log(`[Comando] Ejecutando: ${command.name} | Usuario: ${message.key.remoteJid}`);
                const m = { ...message, chat: message.key.remoteJid, sender: message.key.participant || message.key.remoteJid };
                await command.execute(m, { conn: this.sock, args, usedPrefix, command: commandName, commands: this.commands });
            } catch (error) {
                console.error(`[Error] en el comando ${command.name}:`, error);
                await this.sock.sendMessage(message.key.remoteJid, { text: `Ocurrió un error al ejecutar el comando: ${error.message}` }, { quoted: message });
            } finally {
                // Se asegura de quitar el "escribiendo..." sin importar si el comando tuvo éxito o falló
                await this.sock.sendPresenceUpdate('available', message.key.remoteJid);
            }
        }
    }
}

const bot = new WhatsAppBot();
bot.startBot().catch(error => {
    console.error('[Error Crítico] Fallo al iniciar el bot:', error);
});

process.on('SIGINT', () => {
    console.log('[MayBot] Apagando...');
    process.exit(0);
});
