import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type } = handleDisconnection(this.name, reason);
     
            process.exit(1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            serverProxy.login();
            // [mindaxis-patch:death-zones-load] 起動時に死亡地点リストをロード
            try {
                const _dzPath = `./bots/${this.name}/death_zones.json`;
                this.bot._deathZones = existsSync(_dzPath) ? JSON.parse(readFileSync(_dzPath, 'utf8')) : [];
                if (this.bot._deathZones.length > 0)
                    console.log(`[death-zones] Loaded ${this.bot._deathZones.length} danger zones`);
            } catch(e) { this.bot._deathZones = []; }
            // [mindaxis-patch:villager-blacklist-restore] pending ブラックリストを bot に適用
            if (this._pendingBlockedNitwitIds && this._pendingBlockedNitwitIds.size > 0) {
                this.bot._blockedVillagerIds = this._pendingBlockedNitwitIds;
                console.log('[mindaxis] Restored blocked nitwit IDs to bot:', [...this._pendingBlockedNitwitIds].join(', '));
                this._pendingBlockedNitwitIds = null;
            }
            // [mindaxis-patch:nitwit-area-restore] ニットウィットエリアを bot に適用
            this.bot._nitwitAreas = this._pendingNitwitAreas || [];
            if (this.bot._nitwitAreas.length > 0) {
                console.log('[mindaxis] Restored nitwit areas:', this.bot._nitwitAreas.map(a => `(${a.x},${a.z})`).join(', '));
            }
            this._pendingNitwitAreas = null;
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });
		const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
              
                this._setupEventHandlers(save_data, init_message);
                this.startEvents();

                // [mindaxis-patch:twin-map-server] 2Dマップサーバー起動
                try {
                    const { createRequire } = await import('module');
                    const _require = createRequire(import.meta.url);
                    const mapServer = _require('../../../scripts/twin-map-server.cjs');
                    mapServer.start(this.bot, this.name);
                } catch (_mapErr) { console.error('[MapServer] Failed to start:', _mapErr.message); }

                // [mindaxis-patch:chunk-queue] map_chunk パケットを1枚ずつ setImmediate で処理
                // → チャンクデコード（同期・重い）の間に physicsTick が割り込めるようにする
                (() => {
                    const _client = this.bot._client;
                    const _origEmit = _client.emit.bind(_client);
                    let _chunkQueue = [];
                    let _draining = false;

                    function drainChunkQueue() {
                        if (_chunkQueue.length === 0) { _draining = false; return; }
                        _draining = true;
                        const args = _chunkQueue.shift();
                        _origEmit('map_chunk', ...args);
                        setImmediate(drainChunkQueue);
                    }

                    _client.emit = function(event, ...args) {
                        if (event === 'map_chunk') {
                            _chunkQueue.push(args);
                            if (!_draining) drainChunkQueue();
                            return true;
                        }
                        return _origEmit(event, ...args);
                    };
                })();

                // [mindaxis-patch:water-watchdog] 水中ウォッチドッグ — 頭が5秒以上水没なら現在のコマンドを中断
                (() => {
                    let _waterTicks = 0;
                    const _bot = this.bot;
                    setInterval(() => {
                        try {
                            if (!_bot.entity) return;
                            // 頭（目の高さ y+1.62）のブロックが水かチェック
                            const _eyePos = _bot.entity.position.offset(0, 1.62, 0);
                            const _eyeBlock = _bot.blockAt(_eyePos);
                            const _headSubmerged = _eyeBlock && (_eyeBlock.name === 'water' || _eyeBlock.name === 'flowing_water');
                            if (_headSubmerged) {
                                _waterTicks++;
                                // 5秒水没で中断
                                if (_waterTicks >= 5 && !_bot.interrupt_code) {
                                    // goToSurface 実行中は中断しない
                                    if (_bot._goToSurfaceActive) { _waterTicks = 3; return; }
                                    console.log('[water-watchdog] Head submerged for ' + _waterTicks + 's, interrupting current command');
                                    _bot.interrupt_code = true;
                                    _waterTicks = 0;
                                }
                            } else {
                                _waterTicks = 0;
                            }
                        } catch(_wwe) {}
                    }, 1000);
                    console.log('[water-watchdog] Started');
                })();
              
                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(0);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                let execute_res = await executeCommand(this, message);
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);
            // [mindaxis-patch:bot-response-event] LLM応答をマップサーバーに通知
            try { this.bot.emit('botResponse', this.name, res, source); } catch(_e) {}

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                let execute_res = await executeCommand(this, res);

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {
                const _now = new Date();
                const _hh = _now.getHours().toString().padStart(2, '0');
                const _mm = _now.getMinutes().toString().padStart(2, '0');
                this.bot.chat(`[${_hh}:${_mm}] ${message}`);
            }
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.bot._lastDeathTime = Date.now(); // [mindaxis-patch:death-timer]
            this.actions.cancelResume();
            this.actions.stop();
            // [mindaxis-patch:death-plan-reinsert-v1] 死亡時インベントリを保存（spawn でチェック）
            try { this.bot._inventoryAtDeath = this.bot.inventory.items().map(i => i.name); } catch(e) { this.bot._inventoryAtDeath = null; }
            // [mindaxis-patch:death-zones-save] 死亡地点をスコア付きで記録
            try {
                const _pos = this.bot.entity.position;
                const _cause = this.bot._pendingDeathCause || 'unknown';
                this.bot._pendingDeathCause = null;
                const _dzPath = `./bots/${this.name}/death_zones.json`;
                let _zones = [];
                try { _zones = JSON.parse(readFileSync(_dzPath, 'utf8')); } catch(e) {}
                const _near = _zones.find(z => Math.abs(z.x-_pos.x)<8 && Math.abs(z.y-_pos.y)<8 && Math.abs(z.z-_pos.z)<8);
                if (_near) { _near.count = (_near.count||1)+1; _near.cause = _cause; }
                else { _zones.push({x:Math.round(_pos.x),y:Math.round(_pos.y),z:Math.round(_pos.z),cause:_cause,count:1}); }
                _zones.sort((a,b)=>b.count-a.count);
                if (_zones.length>30) _zones.length=30;
                writeFileSync(_dzPath, JSON.stringify(_zones));
                this.bot._deathZones = _zones;
                console.log(`[death-zones] Saved death at (${Math.round(_pos.x)},${Math.round(_pos.y)},${Math.round(_pos.z)}) cause=${_cause} count=${(_near?.count||1)}`);
            } catch(e) { console.log('[death-zones] Save error:', e.message); }
        });
        // [mindaxis-patch:death-plan-reinsert-v1] リスポーン後にキーアイテム消失を確認してプランを再挿入
        this.bot.on('spawn', () => {
            // [mindaxis-patch:auto-equip-on-spawn] リスポーン後に防具を自動装備
            setTimeout(() => { try { this.bot.armorManager.equipAll(); } catch(e) {} }, 2000);
            if (!this.bot._inventoryAtDeath) return;
            const _prevInv = this.bot._inventoryAtDeath;
            this.bot._inventoryAtDeath = null;
            const _self = this;
            setTimeout(() => {
                try {
                    // [mindaxis-patch:death-plan-reinsert-v2] diamond 個数チェック追加
                    const _KEY = [
                        // ダイヤ装備 → deep-mining 再挿入
                        { name: 'diamond_pickaxe',    phaseId: 'deep-mining', minCount: 1 },
                        { name: 'diamond_sword',      phaseId: 'deep-mining', minCount: 1 },
                        { name: 'diamond_chestplate', phaseId: 'deep-mining', minCount: 1 },
                        { name: 'diamond',            phaseId: 'deep-mining', minCount: 6 },
                        // 鉄装備 → iron-age 再挿入
                        { name: 'iron_pickaxe',       phaseId: 'iron-age',    minCount: 1 },
                        { name: 'iron_sword',         phaseId: 'iron-age',    minCount: 1 },
                        { name: 'iron_chestplate',    phaseId: 'iron-age',    minCount: 1 },
                        // 石器 → stone-age 再挿入
                        { name: 'stone_pickaxe',      phaseId: 'stone-age',   minCount: 1 },
                        { name: 'stone_sword',        phaseId: 'stone-age',   minCount: 1 },
                        // 木器 → first-day 再挿入（石器もなければ）
                        { name: 'wooden_pickaxe',     phaseId: 'first-day',   minCount: 1 },
                    ];
                    const _curInvItems = _self.bot.inventory.items();
                    const _curInv = _curInvItems.map(i => i.name);
                    const _curInvCount = (name) => _curInvItems.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                    const _prevInvCount = (name) => _prevInv.filter(n => n === name).length; // death 時は配列（個数分 push してないので 1 のみ）
                    let _chestItems = [];
                    let _chestCounts = {};
                    try {
                        const _cs = JSON.parse(readFileSync(`./bots/${_self.name}/chest_summary.json`, 'utf8'));
                        _chestItems = (_cs.items || []).map(i => i.name || i);
                        for (const _ci of (_cs.items || [])) { _chestCounts[_ci.name || _ci] = (_chestCounts[_ci.name || _ci] || 0) + (_ci.count || 1); }
                    } catch(e) {}
                    const _planPath = `./bots/${_self.name}/current_plan.json`;
                    if (!existsSync(_planPath)) return;
                    let _planData;
                    try { _planData = JSON.parse(readFileSync(_planPath, 'utf8')); } catch(e) { return; }
                    let _changed = false;
                    for (const _ki of _KEY) {
                        if (!_prevInv.includes(_ki.name)) continue; // 死亡前に持っていなかった
                        const _nowCount = _curInvCount(_ki.name) + (_chestCounts[_ki.name] || 0);
                        if (_nowCount >= (_ki.minCount || 1)) continue; // 今も十分持っている（インベントリ+チェスト合計）
                        // アイテムを失った → 同じフェーズのプランを現在位置の直後に新規挿入
                        const _existingPlan = _planData.plans.find(p => p.phaseId === _ki.phaseId);
                        if (!_existingPlan) continue;
                        if (_existingPlan.status !== 'completed' && _existingPlan.status !== 'skipped') continue;
                        // 既に同フェーズの pending プランが直後にあれば挿入不要
                        const _insertAt = _planData.currentPlanIndex + 1;
                        const _alreadyQueued = _planData.plans.slice(_insertAt).some(p => p.phaseId === _ki.phaseId && p.status === 'pending');
                        if (_alreadyQueued) continue;
                        console.log(`[death-plan-reinsert] ${_ki.name} を死亡で失った → ${_ki.phaseId} を index ${_insertAt} に再挿入`);
                        const _newPlan = JSON.parse(JSON.stringify(_existingPlan));
                        _newPlan.status = 'pending';
                        for (const _s of _newPlan.steps) { _s.done = false; delete _s.skipped; }
                        _newPlan.reason = `死亡によりアイテムを消失 — 再取得のため再実行 (${new Date().toISOString()})`;
                        _planData.plans.splice(_insertAt, 0, _newPlan);
                        _changed = true;
                    }
                    if (_changed) {
                        writeFileSync(_planPath, JSON.stringify(_planData, null, 2));
                        console.log('[death-plan-reinsert] current_plan.json を更新しました');
                        _self.handleMessage('system', 'You died and lost key items. A recovery plan has been inserted after the current plan step — complete the current step first, then re-obtain the lost items.');
                    }
                } catch(e) { console.log('[death-plan-reinsert] エラー:', e.message); }
            }, 3000); // リスポーン後3秒待ってインベントリを確認
        });

        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                // [mindaxis-patch:death-cause-extract] 死亡原因を抽出して death イベントに渡す
                if (message.includes('drown')) this.bot._pendingDeathCause = 'drown';
                else if (message.includes('lava') || message.includes('burn')) this.bot._pendingDeathCause = 'lava';
                else if (message.includes('fall') || message.includes('fell')) this.bot._pendingDeathCause = 'fall';
                else if (message.includes('suffocate') || message.includes('wall')) this.bot._pendingDeathCause = 'suffocate';
                else this.bot._pendingDeathCause = 'other';
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(0)}, y: ${death_pos.y.toFixed(0)}, z: ${death_pos.z.toFixed(0)}`; // [mindaxis-patch:death-coords-fix]
                }
                let dimention = this.bot.game.dimension;
                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`);
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
        this.history.save();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}