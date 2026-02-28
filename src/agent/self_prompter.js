const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.prompt = prompt;
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        try { // [mindaxis-patch:loop-guard] 例外時に loop_active を確実にリセット
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        while (!this.interrupt) {
            // [mindaxis-patch:house-hint] 家の状態をヒントとして追加
            let houseHint = '';
            {
                let hs = this.agent.bot._houseStructure;
                // house.json から復元（_houseStructure が未設定の場合）
                if (!hs) {
                    try {
                        const _fs = await import('fs');
                        const _housePath = './bots/' + this.agent.bot.username + '/house.json';
                        if (_fs.existsSync(_housePath)) {
                            const _hd = JSON.parse(_fs.readFileSync(_housePath, 'utf8'));
                            if (_hd && _hd.bounds) {
                                // cramped が未保存の場合は freeTiles で再計算
                                if (_hd.cramped === undefined || _hd.cramped === null) {
                                    const _freeTiles = (_hd.interiorArea || 0) - (_hd.furniture ? _hd.furniture.length : 0);
                                    _hd.cramped = _freeTiles <= 12 && (_hd.furniture ? _hd.furniture.length : 0) >= 2;
                                }
                                this.agent.bot._houseStructure = _hd;
                                hs = _hd;
                            }
                        }
                    } catch(_e) {}
                }
                // [mindaxis-patch:door-front-coord] ドア外側座標を帰宅座標として使う（家の内部中心ではなく）
                // pathfinder が壁に阻まれず、ドア前に直接到達できる
                let _homeX, _homeY, _homeZ;
                if (hs && hs.bounds) {
                    _homeX = Math.floor((hs.bounds.x1+hs.bounds.x2)/2);
                    _homeY = (hs.bounds.y||69)+1;
                    _homeZ = Math.floor((hs.bounds.z1+hs.bounds.z2)/2);
                    if (hs.door) {
                        const _f = hs.door.facing;
                        _homeX = hs.door.x + (_f==='east'?1:_f==='west'?-1:0);
                        _homeZ = hs.door.z + (_f==='south'?1:_f==='north'?-1:0);
                    }
                }
                if (hs && hs.cramped && !hs.enclosed) {
                    // cramped だが enclosed=false → 壁が壊れている（expandHouse が中途で止まった等）
                    // まず壁を修復してから拡張するよう誘導する
                    houseHint = ' !! TOP PRIORITY: HOUSE WALLS ARE BROKEN (enclosed=false). Go home immediately: !goToCoordinates(' + _homeX + ', ' + _homeY + ', ' + _homeZ + ', 1). Then run !repairHouse to seal the walls. After walls are fixed (!scanHouse returns enclosed=true), THEN expand: !expandHouse("east", 4).';
                } else if (hs && hs.cramped) {
                    const _expandSuggest = hs.description && hs.description.match(/!expandHouse\([^)]+\)/);
                    const _expandCmd = _expandSuggest ? _expandSuggest[0] : '!expandHouse("east", 4)';
                    houseHint = ' !! TOP PRIORITY: YOUR HOUSE IS TOO CRAMPED (freeTiles=' + ((hs.interiorArea||0)-(hs.furniture?hs.furniture.length:0)) + '). Run ' + _expandCmd + ' NOW — skip your current plan step and expand first. If it is nighttime, sleep first (!goToBed), then expand immediately after waking up. Do NOT add furniture or continue other plan steps until the house is expanded.';
                } else if (hs && hs.enclosed && hs.interior) {
                    let _furnitureNote = '';
                    if (hs.furniture && hs.furniture.length > 0) {
                        const _furnitureNames = [...new Set(hs.furniture.map(f => f.split('@')[0]))];
                        _furnitureNote = ' Your house already has: ' + _furnitureNames.join(', ') + '. Do NOT craft items you already have placed (e.g. if you have a bed, use !goToBed instead of crafting a new one).';
                    }
                    houseHint = ' YOU ALREADY HAVE A HOUSE at x=' + hs.bounds.x1 + '-' + hs.bounds.x2 + ' z=' + hs.bounds.z1 + '-' + hs.bounds.z2 + ' floor_y=' + (hs.bounds.y || 69) + '. DO NOT build a new house! HOME DOOR FRONT: !goToCoordinates(' + _homeX + ', ' + _homeY + ', ' + _homeZ + ', 1) to go home (this is the door front — walk through to enter). Place furniture INSIDE interior bounds (x=' + hs.interior.x1 + '-' + hs.interior.x2 + ', z=' + hs.interior.z1 + '-' + hs.interior.z2 + ').' + _furnitureNote;
                } else if (hs && hs.bounds && !hs.enclosed) {
                    houseHint = ' YOU HAVE A HOUSE at x=' + hs.bounds.x1 + '-' + hs.bounds.x2 + ' z=' + hs.bounds.z1 + '-' + hs.bounds.z2 + ' floor_y=' + (hs.bounds.y || 69) + ' that may need repair. HOME DOOR FRONT: !goToCoordinates(' + _homeX + ', ' + _homeY + ', ' + _homeZ + ', 1) to go home, then !scanHouse to check it.';
                } else if (hs && hs.bounds) {
                    houseHint = ' YOU ALREADY HAVE A HOUSE at x=' + hs.bounds.x1 + '-' + hs.bounds.x2 + ' z=' + hs.bounds.z1 + '-' + hs.bounds.z2 + ' floor_y=' + (hs.bounds.y || 69) + '. DO NOT build a new house! HOME DOOR FRONT: !goToCoordinates(' + _homeX + ', ' + _homeY + ', ' + _homeZ + ', 1) to go home (this is the door front — walk through to enter).';
                }
            }
            // [mindaxis-patch:plan-hint-v2] プランヒント + 死亡タイマー（critical対応）
            let planHint = '';
            {
                // --- 死亡アイテム回収タイマー ---
                const _deathTime = this.agent.bot._lastDeathTime;
                if (_deathTime && Date.now() - _deathTime < 300000) {
                    const _remaining = Math.ceil((300000 - (Date.now() - _deathTime)) / 1000);
                    const _deathPos = this.agent.memory_bank.recallPlace('last_death_position');
                    const _deathPosText = _deathPos ? `x=${Math.round(_deathPos[0])}, y=${Math.round(_deathPos[1])}, z=${Math.round(_deathPos[2])}` : 'unknown';
                    planHint += ' URGENT: You died ' + Math.floor((Date.now() - _deathTime)/1000) + 's ago at ' + _deathPosText + '. Use !goToCoordinates(' + ((_deathPos&&Math.round(_deathPos[0]))||'?') + ', ' + ((_deathPos&&Math.round(_deathPos[1]))||'?') + ', ' + ((_deathPos&&Math.round(_deathPos[2]))||'?') + ', 2) to recover items (' + _remaining + 's left before despawn). // [mindaxis-patch:death-coords-hint]';
                } else if (_deathTime && Date.now() - _deathTime >= 300000) {
                    planHint += ' Your dropped items have DESPAWNED (5+ minutes since death). Do NOT try to recover them. Resume normal activities and your current plan.';
                    this.agent.bot._lastDeathTime = null;
                }
                // [mindaxis-patch:danger-zones-hint] 死亡地点を危険ゾーンとしてAIに警告
                const _dzones = this.agent.bot._deathZones || [];
                if (_dzones.length > 0) {
                    const _dzStr = _dzones.slice(0, 5).map(z => `(${z.x},${z.y},${z.z})=${z.cause}×${z.count}`).join(', ');
                    planHint += ' KNOWN DANGER ZONES: ' + _dzStr + '. These locations have caused death before — approach with extreme caution or avoid entirely. Water zones (drown) are especially lethal; do not enter without an escape plan.';
                }
                // --- マクロプランヒント ---
                try {
                    const _fs = await import('fs');
                    const _planPath = process.env.MINDAXIS_PLAN_PATH;
                    if (_planPath && _fs.existsSync(_planPath)) {
                        const _pd = JSON.parse(_fs.readFileSync(_planPath, 'utf8'));
                        if (_pd && _pd.plans && _pd.plans.length > 0) {
                            const _ci = _pd.currentPlanIndex || 0;
                            const _plan = _pd.plans[_ci];
                            if (_plan && _plan.status !== 'completed') {
                                const _steps = _plan.steps || [];
                                const _currentStep = _steps.findIndex(s => !s.done);
                                const _totalSteps = _steps.length;
                                if (_currentStep >= 0) {
                                    const _isCritical = _steps[_currentStep].critical;
                                    const _stepDesc = _steps[_currentStep].step || '';
                                    const _isExploreStep = /find|search|village|villager|locate|discover|explore/i.test(_stepDesc) || /find|search|village|villager|locate|discover/i.test(_plan.goal || '');
                                    const _skipRule = _isCritical
                                        ? 'This step is CRITICAL and CANNOT be skipped. But do NOT over-prepare! First !inventory to see what you already have, then !takeFromChest for missing items. Stone tools are fine if iron is not available — do NOT spend more than 2 turns gathering materials. Leave with minimum gear (stone tools + food) rather than wasting time.'
                                        : _isExploreStep
                                        ? 'This step requires EXPLORATION — keep moving and searching! !searchForEntity only detects entities in already-loaded chunks (~250 block radius). If it returns nothing: use !moveAway(300) to travel to new unexplored chunks, then search again. Repeat: !searchForEntity → nothing → !moveAway(300) → !searchForEntity → keep going. If surrounded by water, craft a boat: !craftRecipe("oak_boat", 1), then swim across. NOTE: !searchForEntity max range is 512 — do NOT exceed it. Only use !planSkip after 5+ move+search cycles with no results.'
                                        : 'If you cannot find what the step requires after 2-3 attempts, use !planSkip to skip it and move on — do NOT keep searching for the same thing or get sidetracked collecting other resources.';
                                    planHint += ' CURRENT PLAN: 「' + _plan.goal + '」(Step ' + (_currentStep+1) + '/' + _totalSteps + ': ' + _steps[_currentStep].step + '). PLAN RULE: Follow the current step. When done, use !planDone to mark complete and advance. ' + _skipRule + ' IMPORTANT: Do NOT build a new house — you already have one. ONLY build structures if the current plan step explicitly requires it.';
                                } else {
                                    planHint += ' PLAN 「' + _plan.goal + '」is all steps done. Use !planNext to move to next plan.';
                                }
                            }
                            // 日常ルーチン
                            if (_pd.dailyRoutine) {
                                const _time = this.agent.bot.time?.timeOfDay;
                                if (_time != null) {
                                    if (_time >= 12000 && _time < 13000) {
                                        planHint += ' EVENING: Go home, organize inventory, store items in chests.';
                                    } else if (_time >= 13000 || _time < 100) {
                                        const _hasBed = this.agent.bot.inventory.items().some(i => i.name.includes('_bed'));
                                    if (_hasBed) {
                                        planHint += ' NIGHT: You have a bed in your inventory. Use !goToBed to sleep wherever you are — it places the bed, sleeps through the night, then picks it back up automatically.';
                                    } else {
                                        planHint += ' NIGHT: Stay inside your house. You have a bed placed at home — use !goToBed to sleep. If !goToBed fails, go home first with !goToCoordinates then try !goToBed again.';
                                    }
                                    }
                                }
                            }
                        }
                    }
                } catch(_pe) {}
                // インベントリ概要（アイテム名のみ、個数なし）
                try {
                    const _items = this.agent.bot.inventory.items();
                    if (_items.length > 0) {
                        const _names = [...new Set(_items.map(i => i.name))];
                        planHint += ' INVENTORY: ' + _names.join(', ') + '.';
                    } else {
                        planHint += ' INVENTORY: empty.';
                    }
                } catch(_ie) {}
                // チェスト概要（家のチェストのみ、アイテム名のみ）
                try {
                    let _chestNames = this.agent.bot._chestSummary;
                    if (!_chestNames) {
                        const _fs3 = await import('fs');
                        const _csPath = './bots/' + this.agent.bot.username + '/chest_summary.json';
                        if (_fs3.existsSync(_csPath)) {
                            const _csData = JSON.parse(_fs3.readFileSync(_csPath, 'utf8'));
                            _chestNames = _csData.items;
                            this.agent.bot._chestSummary = _chestNames;
                        }
                    }
                    if (_chestNames && _chestNames.length > 0) {
                        planHint += ' HOME CHEST: ' + _chestNames.join(', ') + '.';
                    }
                } catch(_ce) {}
                // [mindaxis-patch:farm-status-hint] farmland 不足ヒント
                try {
                    const _farmBot = this.agent.bot;
                    const _farmBlocks = _farmBot.findBlocks({
                        matching: block => block.name === 'farmland' || block.name === 'wheat' || block.name === 'carrots' || block.name === 'potatoes' || block.name === 'beetroots',
                        maxDistance: 60,
                        count: 20
                    });
                    // 地上のfarmlandのみカウント（y > 60）
                    const _surfaceFarm = _farmBlocks.filter(pos => pos.y > 60 && pos.y > 55);
                    if (_surfaceFarm.length < 4) {
                        const _hasHoe = _farmBot.inventory.items().some(i => i.name.includes('hoe'));
                        const _hasSeeds = _farmBot.inventory.items().some(i => i.name.includes('seeds') || i.name.includes('seed'));
                        if (_hasHoe && _hasSeeds) {
                            planHint += ' FARM ALERT: Only ' + _surfaceFarm.length + ' farmland block(s) on surface (need 4+). Create a small farm near home: use !useOn("stone_hoe","grass_block") on surface grass, then !useOn("wheat_seeds","farmland") to plant. IMPORTANT: Only farm on the surface — NOT underground.';
                        } else if (_surfaceFarm.length === 0) {
                            planHint += ' FARM ALERT: No farmland found near home. Get a hoe (!craftRecipe("stone_hoe",1)) and seeds (!collectBlocks("grass",4) drops wheat_seeds), then till surface grass to create a farm.';
                        }
                    }
                } catch(_fe) {}
                // [mindaxis-patch:underwater-emergency-hint] 水中緊急ヒント（頭が水没した場合のみ）
                try {
                    const _uwBot = this.agent.bot;
                    if (_uwBot.entity) {
                        const _eyePos = _uwBot.entity.position.offset(0, 1.62, 0);
                        const _eyeBlock = _uwBot.blockAt(_eyePos);
                        const _headSubmerged = _eyeBlock && (_eyeBlock.name === 'water' || _eyeBlock.name === 'flowing_water');
                        if (_headSubmerged) {
                            planHint += ' UNDERWATER EMERGENCY: Your head is underwater and you will drown! Your NEXT action MUST be !goToSurface — it swims to shore and gets you above water. Do NOT call !moveAway while underwater.';
                        }
                    }
                } catch(_uwe) {}
                // [mindaxis-patch:stay-out-hint-v2] 遠出時は帰宅抑制（夜・インベントリ満杯・食料切れは除外）
                try {
                    const _soBot = this.agent.bot;
                    const _soHs = _soBot._houseStructure;
                    const _soTime = _soBot.time && _soBot.time.timeOfDay;
                    const _soIsNight = _soTime != null && (_soTime >= 12500 || _soTime < 100);
                    if (!_soIsNight && _soHs && _soHs.bounds && _soBot.entity) {
                        const _soPos = _soBot.entity.position;
                        const _soHx = (_soHs.bounds.x1 + _soHs.bounds.x2) / 2;
                        const _soHz = (_soHs.bounds.z1 + _soHs.bounds.z2) / 2;
                        const _soDist = Math.sqrt((_soPos.x-_soHx)**2 + (_soPos.z-_soHz)**2);
                        if (_soDist > 50) {
                            const _soTypes = new Set(_soBot.inventory.items().map(i => i.name)).size;
                            const _soFood = _soBot.inventory.items().some(i => ['apple','bread','cooked_beef','salmon','cooked_salmon','mutton','cooked_mutton','porkchop','cooked_porkchop','carrot','potato','baked_potato','cooked_chicken','chicken'].includes(i.name));
                            if (_soTypes < 12 && _soFood) {
                                planHint += ' STAY OUT: You are ' + Math.round(_soDist) + ' blocks from home, it is daytime, and inventory is not full (' + _soTypes + '/12 item types). Keep exploring! Do NOT go home just to deposit items. Only go home when (a) inventory reaches 12+ item types, (b) food runs out, or (c) it becomes night.';
                            }
                        }
                    }
                } catch(_soe) {}
                // [mindaxis-patch:gameplay-tips] ゲームプレイのヒント
                planHint += ' TIPS: Breaking placed blocks (torches, crafting_table, furnace, chests, planks, fences, etc.) drops them into your inventory — you can recover resources by mining them. If !goToCoordinates keeps failing near water, craft a boat (!craftRecipe("oak_boat", 1) needs 5 planks) and use !boatTo(x, y, z) to cross water.';
            }
            const msg = `You are self-prompting with the goal: '${this.prompt}'.${houseHint}${planHint} Your next response MUST contain a command with this syntax: !commandName. /* [mindaxis-patch:chest-management-v2] */ CHEST RULE: NEVER place chests outside your home base. RESOURCE RULE: Only use !takeFromChest when you are at home preparing to go out. When exploring far from home (50+ blocks away), do NOT return just to deposit items — keep exploring until (a) inventory has 12+ item types, (b) food runs out, or (c) it is night without a bed. Do NOT take furniture (furnace, crafting_table) from chests. A BED is OK to carry for exploration — !goToBed places it, sleeps, then picks it back up. BUILDING RULE: NEVER place cobblestone, stone, dirt, oak_planks, or other building blocks inside your house. Only place furniture (bed, chest, furnace, crafting_table, torch). FURNITURE PLACEMENT: Place furniture against the back and side walls, away from the door entrance. Keep the area near the door clear for easy entry/exit. Respond:`;
            
            // [mindaxis-patch:cmd-watchdog-v3] コマンドウォッチドッグ — 90s デフォルト、bot._requestWatchdogMs で延長可
            const _wdBot = this.agent.bot;
            _wdBot._requestWatchdogMs = null; // reset before each command
            const _wdDefaultMs = 90000;
            let _wdActiveMs = _wdDefaultMs;
            const _wdStartTime = Date.now();
            let _wdHandle;
            const _scheduleWatchdog = (remainingMs) => {
                clearTimeout(_wdHandle);
                _wdHandle = setTimeout(() => {
                    // コマンドが延長要請していれば延長する
                    if (_wdBot._requestWatchdogMs && _wdBot._requestWatchdogMs > _wdActiveMs) {
                        _wdActiveMs = _wdBot._requestWatchdogMs;
                        _wdBot._requestWatchdogMs = null;
                        const remaining = _wdActiveMs - (Date.now() - _wdStartTime);
                        if (remaining > 0) { _scheduleWatchdog(remaining); return; }
                    }
                    try { _wdBot.interrupt_code = true; } catch(_we) {}
                    try { _wdBot.pathfinder.stop(); } catch(_we) {}
                    const elapsed = Math.round((Date.now() - _wdStartTime) / 1000);
                    console.log(`[mindaxis] Watchdog: command force-interrupted after ${elapsed}s`);
                }, remainingMs);
            };
            _scheduleWatchdog(_wdDefaultMs);
            let used_command;
            try {
                used_command = await this.agent.handleMessage('system', msg, -1);
            } finally {
                clearTimeout(_wdHandle);
            }
            // [mindaxis-patch:loop-detect-v3] 同じステップで8ターン→物理スタックならvision-unstuck、論理スタックなら!planSkip
            try {
                if (this._loopStepKey == null) this._loopStepKey = '';
                if (this._loopTurns == null) this._loopTurns = 0;
                if (this._loopStartPos == null) this._loopStartPos = null;
                const _fs2 = await import('fs');
                const _lp = process.env.MINDAXIS_PLAN_PATH;
                if (_lp && _fs2.existsSync(_lp)) {
                    const _lpd = JSON.parse(_fs2.readFileSync(_lp, 'utf8'));
                    const _lci = _lpd.currentPlanIndex || 0;
                    const _lplan = _lpd.plans && _lpd.plans[_lci];
                    if (_lplan && _lplan.steps) {
                        const _lstep = _lplan.steps.findIndex(s => !s.done);
                        const _lsText = (_lstep >= 0 && _lplan.steps[_lstep]) ? _lplan.steps[_lstep].step || '' : '';
                        const _stepKey = _lci + ':' + _lstep;
                        if (_stepKey === this._loopStepKey) {
                            this._loopTurns++;
                        } else {
                            this._loopStepKey = _stepKey;
                            this._loopTurns = 0;
                            // 新しいステップ開始時の位置を記録
                            const _bp = this.agent.bot.entity ? this.agent.bot.entity.position : null;
                            this._loopStartPos = _bp ? { x: _bp.x, y: _bp.y, z: _bp.z } : null;
                        }
                        // 毎ターン位置チェック: 物理スタック=3ターン、論理スタック=8ターン
                        let _isPhysical = false;
                        const _curPos = this.agent.bot.entity ? this.agent.bot.entity.position : null;
                        if (this._loopStartPos && _curPos) {
                            const _dx = _curPos.x - this._loopStartPos.x;
                            const _dy = _curPos.y - this._loopStartPos.y;
                            const _dz = _curPos.z - this._loopStartPos.z;
                            const _dist = Math.sqrt(_dx*_dx + _dy*_dy + _dz*_dz);
                            _isPhysical = _dist < 5;
                        }
                        const _threshold = _isPhysical ? 3 : 8;
                        if (this._loopTurns >= _threshold) {
                            if (_isPhysical) {
                                console.log('[mindaxis] PHYSICAL stuck: plan ' + _lci + ' step ' + (_lstep+1) + ', ' + this._loopTurns + ' turns, < 5 blocks moved');
                            } else {
                                console.log('[mindaxis] LOGICAL stuck: plan ' + _lci + ' step ' + (_lstep+1) + ', ' + this._loopTurns + ' turns');
                            }
                            this._loopTurns = 0;
                            if (_isPhysical && this.agent.bot._visionUnstuck) {
                                // 物理スタック → vision-unstuck で画像分析
                                let _vuCmd = '!planSkip';
                                try {
                                    const { createRequire: _cr3 } = await import('module');
                                    const _req3 = _cr3(import.meta.url);
                                    const _vu = _req3('../../../scripts/vision-unstuck.cjs');
                                    const _bot = this.agent.bot;
                                    const _inv = [];
                                    try { for (const _it of _bot.inventory.items()) { _inv.push(_it.name + ' x' + _it.count); } } catch(_ie) {}
                                    const _recentActions = [];
                                    try { const _h = this.agent.history; if (_h && _h.turns) { for (let _ri = Math.max(0, _h.turns.length - 5); _ri < _h.turns.length; _ri++) { const _t = _h.turns[_ri]; if (_t && _t.content) _recentActions.push(typeof _t.content === 'string' ? _t.content.slice(0, 200) : String(_t.content).slice(0, 200)); } } } catch(_he) {}
                                    _vuCmd = await _vu.analyze(_bot, {
                                        name: this.agent.name,
                                        position: _curPos || { x: 0, y: 0, z: 0 },
                                        planStep: _lsText,
                                        loopTurns: 8,
                                        inventory: _inv.join(', ') || 'empty',
                                        recentActions: _recentActions.length > 0 ? _recentActions : ['(none)'],
                                    });
                                    console.log('[mindaxis] vision-unstuck returned: ' + _vuCmd);
                                } catch(_vuErr) { console.error('[mindaxis] vision-unstuck error:', _vuErr.message); }
                                await this.agent.handleMessage('system', 'PHYSICAL STUCK DETECTED: You have not moved for 8 turns. Execute this command immediately: ' + _vuCmd, -1);
                            } else {
                                // 論理スタック → critical ステップなら代替案を提案、それ以外は !planSkip
                                const _isCrit = (_lstep >= 0 && _lplan.steps[_lstep]) ? _lplan.steps[_lstep].critical : false;
                                if (_isCrit) {
                                    console.log('[mindaxis] Logical stuck on CRITICAL step → suggesting alternatives');
                                    await this.agent.handleMessage('system', 'LOOP DETECTED on a CRITICAL step (equipment preparation). You CANNOT skip this step. Try simpler alternatives: craft stone tools instead of iron, use available food, make basic torches. Use !inventory to check what you have, then !craftRecipe to make what you can with available materials.', -1);
                                } else {
                                    console.log('[mindaxis] Logical stuck → forcing !planSkip');
                                    await this.agent.handleMessage('system', 'LOOP DETECTED: You have been stuck on the same plan step for too many turns without progress. You MUST use !planSkip right now to skip this step and move to the next one. Do NOT continue trying the same thing.', -1);
                                }
                            }
                        }
                    }
                }
            } catch(_le) { console.error('[mindaxis] loop-detect error:', _le.message); }
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    // [mindaxis-patch:no-stop] 永久停止せずリトライ
                    console.warn(`[mindaxis] Agent did not use command in ${MAX_NO_COMMAND} auto-prompts. Nudging...`);
                    no_command_count = 0;
                    await new Promise(r => setTimeout(r, this.cooldown * 3));
                }
            }
            else {
                no_command_count = 0;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
        }
        console.log('self prompt loop stopped')
        } catch (err) {
            // [mindaxis-patch:loop-finally] ループ内例外をキャッチ
            console.error('[mindaxis] Self-prompt loop crashed:', err);
        } finally {
            this.loop_active = false;
            this.interrupt = false;
        }
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) { // [mindaxis-patch:active-restart-lock]
            const _prompterBusy2 = this.agent.prompter && this.agent.prompter.most_recent_msg_time && (Date.now() - this.agent.prompter.most_recent_msg_time < 15000);
            if (this.agent.isIdle() && !_prompterBusy2)
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        // [mindaxis-patch:auto-restart] [mindaxis-patch:default-goal] STOPPED / 未起動でも自動開始
        else if (this.state === STOPPED && !this.loop_active && !this.interrupt) { // [mindaxis-patch:auto-start-lock]
            // prompter が直近 15 秒以内に API 呼び出し中なら自動起動を遅延
            const _prompterBusy = this.agent.prompter && this.agent.prompter.most_recent_msg_time && (Date.now() - this.agent.prompter.most_recent_msg_time < 15000);
            if (this.agent.isIdle() && !_prompterBusy)
                this.idle_time += delta;
            else
                this.idle_time = 0;

            const _threshold = this.prompt ? 60000 : 30000;
            if (this.idle_time >= _threshold) {
                if (!this.prompt) {
                    const _defaultGoal = process.env.MINDAXIS_DEFAULT_GOAL || "Explore the area, gather resources like wood and stone, craft basic tools, and build a small shelter. Stay safe and keep busy!";
                    console.log('[mindaxis] No self-prompting goal set. Auto-starting with default goal:', _defaultGoal);
                    this.start(_defaultGoal);
                } else {
                    console.log('[mindaxis] Self-prompter auto-restarting from STOPPED state...');
                    this.state = ACTIVE;
                    this.startLoop();
                }
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        this.stopLoop();
        this.state = STOPPED;
    }

    async pause() {
        this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}