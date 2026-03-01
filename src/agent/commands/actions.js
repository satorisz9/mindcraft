import * as skills from '../library/skills.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

export const actionsList = [


    // [mindaxis-patch:repair-house] 家の修復コマンド
    {
        name: '!repairHouse',
        description: 'Detect and repair missing wall blocks in your house. Use when !scanHouse shows the structure is not enclosed or when your house walls are damaged.',
        params: {},
        perform: runAsAction(async (agent) => {
            // Don't repair if house is cramped — expandHouse should run instead
            const hs = agent.bot._houseStructure;
            if (hs && hs.cramped) {
                skills.log(agent.bot, 'House is cramped — run !expandHouse instead of !repairHouse.');
                return;
            }
            agent.bot._allowHouseDig = true;
            try {
            const result = await skills.repairStructure(agent.bot);
            // 修復結果をキャッシュ
            const prev = agent.bot._houseStructure;
            if (!result.enclosed && prev?.bounds) {
                result.bounds = prev.bounds;
                result.door = result.door || prev.door;
                result.wallMaterial = result.wallMaterial || prev.wallMaterial;
            }
            agent.bot._houseStructure = result;
            } finally { agent.bot._allowHouseDig = false; }
        })
    },
    // [mindaxis-patch:scan-house] 家の構造スキャンコマンド
    {
        name: '!scanHouse',
        description: 'Scan the structure around you to detect walls, roof, door, and furniture. Use this at your base to understand your house layout before placing beds, chests, or furniture.',
        params: {},
        perform: runAsAction(async (agent) => {
            const bot = agent.bot;
            // 家が既存でボットが遠い場合は警告
            const prev = bot._houseStructure;
            if (prev && prev.bounds) {
                const _p = bot.entity.position;
                const _b = prev.bounds;
                const _cx = (_b.x1 + _b.x2) / 2, _cz = (_b.z1 + _b.z2) / 2;
                const _dist = Math.sqrt((_p.x - _cx) ** 2 + (_p.z - _cz) ** 2);
                if (_dist > 30) {
                    skills.log(bot, 'You are ' + Math.floor(_dist) + ' blocks away from your house. Go home first with !goToCoordinates(' + Math.floor(_cx) + ', ' + ((_b.y||69)+1) + ', ' + Math.floor(_cz) + ', 2) then run !scanHouse.');
                    return;
                }
            }
            const result = await skills.scanStructure(bot);
            // キャッシュして self-prompt に注入できるようにする
            // not-enclosed でも以前の bounds/door を保持（修復用）
            if (!result.enclosed && prev?.bounds) {
                result.bounds = prev.bounds;
                result.door = result.door || prev.door;
                result.wallMaterial = result.wallMaterial || prev.wallMaterial;
            }
            // 家具が見つからなかったが以前の記録がある場合、保持する（描画距離外の可能性）
            if ((!result.furniture || result.furniture.length === 0) && prev?.furniture && prev.furniture.length > 0) {
                result.furniture = prev.furniture;
            }
            bot._houseStructure = result;
            // house.json に家データを永続化（memory.json は history.save() で上書きされるため別ファイル）
            try {
                const _fs = await import('fs');
                const _housePath = './bots/' + bot.username + '/house.json';
                _fs.writeFileSync(_housePath, JSON.stringify({ bounds: result.bounds, door: result.door, wallMaterial: result.wallMaterial, enclosed: !!result.enclosed, interior: result.interior, interiorArea: result.interiorArea, furniture: result.furniture || [], cramped: !!result.cramped }, null, 2));
            } catch(_e) {}
            skills.log(agent.bot, result.description);
        })
    },

    // [mindaxis-patch:build-house] 建築専用コマンド
    {
        name: '!buildHouse',
        description: 'Build a simple house at the current location with proper coordinate handling.',
        params: {
            'width': { type: 'int', description: 'Width of the house (3-10)', domain: [3, 11] },
            'depth': { type: 'int', description: 'Depth of the house (3-10)', domain: [3, 11] },
            'material': { type: 'string', description: 'Wall material (e.g., oak_planks, cobblestone)' }
        },
        perform: runAsAction(async (agent, width, depth, material) => {
            const bot = agent.bot;
            const Vec3 = (await import('vec3')).default;
            const log = (msg) => agent.bot.chat(msg);

            // 家が既にある場合は拒否
            const _hs = bot._houseStructure;
            if (_hs && _hs.bounds) {
                skills.log(bot, 'You already have a house at x=' + _hs.bounds.x1 + '-' + _hs.bounds.x2 + ' z=' + _hs.bounds.z1 + '-' + _hs.bounds.z2 + '. Use !goToCoordinates to go home, then !repairHouse if needed. Do NOT build a new house.');
                return;
            }

            // 1. 地形スキャン
            const pos = bot.entity.position;
            const ox = Math.floor(pos.x) + 2;
            const oz = Math.floor(pos.z) + 2;
            let maxGroundY = -999;
            let minGroundY = 999;
            const groundMap = {};

            for (let dx = 0; dx < width; dx++) {
                for (let dz = 0; dz < depth; dz++) {
                    for (let y = Math.floor(pos.y) + 5; y >= Math.floor(pos.y) - 10; y--) {
                        const b = bot.blockAt(new Vec3(ox + dx, y, oz + dz));
                        if (b && b.name !== 'air' && b.name !== 'cave_air' &&
                            !b.name.includes('leaves') && !b.name.includes('flower') &&
                            b.name !== 'tall_grass' && b.name !== 'short_grass' && b.name !== 'snow') {
                            groundMap[dx + ',' + dz] = y;
                            if (y > maxGroundY) maxGroundY = y;
                            if (y < minGroundY) minGroundY = y;
                            break;
                        }
                    }
                }
            }

            const oy = maxGroundY;
            const variance = maxGroundY - minGroundY;

            if (variance > 3) {
                return `Terrain too uneven (variance: ${variance} blocks). Move to flatter ground.`;
            }

            // 1.5. インベントリチェック — 必要素材が足りなければ早期リターン
            const floorBlocks = width * depth;
            const wallBlocks = (width * 2 + (depth - 2) * 2) * 3 - 2; // 3段, ドア穴2マス分引く
            const roofBlocks = width * depth;
            const totalNeeded = floorBlocks + wallBlocks + roofBlocks;
            const inv = bot.inventory.items();
            const materialCount = inv.filter(i => i.name === material).reduce((s, i) => s + i.count, 0);
            const doorCount = inv.filter(i => i.name === 'oak_door').reduce((s, i) => s + i.count, 0);
            const torchCount = inv.filter(i => i.name === 'torch').reduce((s, i) => s + i.count, 0);

            const missing = [];
            if (materialCount < totalNeeded) missing.push(`${material}: have ${materialCount}, need ${totalNeeded}`);
            if (doorCount < 1) missing.push(`oak_door: have ${doorCount}, need 1`);
            if (torchCount < 2) missing.push(`torch: have ${torchCount}, need 2`);

            if (missing.length > 0) {
                return `Not enough materials to build! Missing: ${missing.join(', ')}. Gather resources first with !collectBlocks or !craftRecipe.`;
            }

            log(`Building ${width}x${depth} house at ox=${ox} oy=${oy} oz=${oz} (using ${totalNeeded} ${material})`);

            // 2. 床を敷く
            for (let dx = 0; dx < width; dx++) {
                for (let dz = 0; dz < depth; dz++) {
                    await skills.placeBlock(bot, material, ox + dx, oy, oz + dz);
                    await skills.wait(bot, 100);
                }
            }

            // 3. 壁を建てる (3ブロック高)
            const wallHeight = 3;
            const doorX = Math.floor(width / 2);

            for (let h = 1; h <= wallHeight; h++) {
                // 北壁 (z = oz)
                for (let dx = 0; dx < width; dx++) {
                    if (dx === doorX && h <= 2) continue; // ドア穴
                    await skills.placeBlock(bot, material, ox + dx, oy + h, oz);
                    await skills.wait(bot, 50);
                }
                // 南壁 (z = oz + depth - 1)
                for (let dx = 0; dx < width; dx++) {
                    await skills.placeBlock(bot, material, ox + dx, oy + h, oz + depth - 1);
                    await skills.wait(bot, 50);
                }
                // 西壁 (x = ox)
                for (let dz = 1; dz < depth - 1; dz++) {
                    await skills.placeBlock(bot, material, ox, oy + h, oz + dz);
                    await skills.wait(bot, 50);
                }
                // 東壁 (x = ox + width - 1)
                for (let dz = 1; dz < depth - 1; dz++) {
                    await skills.placeBlock(bot, material, ox + width - 1, oy + h, oz + dz);
                    await skills.wait(bot, 50);
                }
            }

            // 4. 屋根
            const roofY = oy + wallHeight + 1;
            for (let dx = 0; dx < width; dx++) {
                for (let dz = 0; dz < depth; dz++) {
                    await skills.placeBlock(bot, material, ox + dx, roofY, oz + dz);
                    await skills.wait(bot, 50);
                }
            }

            // 5. ドアを設置
            try {
                await skills.placeBlock(bot, 'oak_door', ox + doorX, oy + 1, oz);
            } catch (e) {
                log('Could not place door');
            }

            // 6. 内装（松明）
            try {
                await skills.placeBlock(bot, 'torch', ox + 1, oy + 2, oz + 1, 'side');
                await skills.placeBlock(bot, 'torch', ox + width - 2, oy + 2, oz + depth - 2, 'side');
            } catch (e) {
                log('Could not place torches');
            }

            return `Built ${width}x${depth} house at (${ox}, ${oy}, ${oz}) with ${material}`;
        }, false, 5)
    },
    // [mindaxis-patch:boat-nav] ボート航行コマンド
    {
        name: '!boatTo',
        description: 'Navigate to coordinates by boat across water. Automatically crafts a boat if you have 5+ planks. Use when !goToCoordinates fails near large water bodies.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: runAsAction(async (agent, x, y, z) => {
            const bot = agent.bot;
            const Vec3 = (await import('vec3')).default;

            // --- 1. Get or craft a boat ---
            let boatItem = bot.inventory.items().find(i => i.name.includes('boat') && !i.name.includes('chest'));
            if (!boatItem) {
                skills.log(bot, 'No boat in inventory. Checking for planks to craft one...');
                const planks = bot.inventory.items().filter(i => i.name.includes('planks'));
                const totalPlanks = planks.reduce((sum, i) => sum + i.count, 0);
                if (totalPlanks < 5) {
                    skills.log(bot, 'Need a boat or 5 planks to craft one. Collect 5 planks first (!collectBlocks("oak_log", 2) then !craftRecipe("oak_planks", 2)).');
                    return;
                }
                try {
                    await skills.craftRecipe(bot, 'oak_boat');
                } catch(e) {
                    skills.log(bot, 'Failed to craft boat: ' + e.message + '. May need a crafting table nearby.');
                    return;
                }
                boatItem = bot.inventory.items().find(i => i.name.includes('boat') && !i.name.includes('chest'));
                if (!boatItem) {
                    skills.log(bot, 'Failed to craft boat. Try placing a crafting table first.');
                    return;
                }
                skills.log(bot, 'Crafted a boat!');
            }

            // --- 2. Find water nearby ---
            const waterBlockId = bot.registry.blocksByName['water'] ? bot.registry.blocksByName['water'].id : null;
            let waterBlock = waterBlockId != null ? bot.findBlock({ matching: waterBlockId, maxDistance: 32 }) : null;
            if (!waterBlock) {
                skills.log(bot, 'No water nearby to place boat. Use !goToCoordinates instead.');
                return;
            }

            // --- 3. Walk close to water ---
            const wp = waterBlock.position;
            try {
                await skills.goToPosition(bot, wp.x, wp.y + 1, wp.z, 3);
            } catch(e) {
                // goToPosition failed but bot may still be close enough
            }

            // --- 4. Equip and place boat ---
            try {
                boatItem = bot.inventory.items().find(i => i.name.includes('boat') && !i.name.includes('chest'));
                if (!boatItem) { skills.log(bot, 'Lost boat item.'); return; }
                await bot.equip(boatItem, 'hand');
            } catch(e) {
                skills.log(bot, 'Failed to equip boat: ' + e.message);
                return;
            }

            // Find closest reachable water block
            let placeTarget = null;
            const botPos = bot.entity.position;
            let bestDist = 999;
            for (let dx = -4; dx <= 4; dx++) {
                for (let dz = -4; dz <= 4; dz++) {
                    for (let dy = -2; dy <= 0; dy++) {
                        const checkPos = botPos.offset(dx, dy, dz);
                        const block = bot.blockAt(checkPos);
                        if (block && block.name === 'water') {
                            const d = botPos.distanceTo(checkPos);
                            if (d < bestDist && d <= 5) {
                                bestDist = d;
                                placeTarget = block;
                            }
                        }
                    }
                }
            }

            if (!placeTarget) {
                skills.log(bot, 'Cannot find reachable water block to place boat on.');
                return;
            }

            let boatEntity;
            try {
                boatEntity = await bot.placeEntity(placeTarget, new Vec3(0, 1, 0));
            } catch(e) {
                skills.log(bot, 'Failed to place boat on water: ' + e.message);
                return;
            }

            // --- 5. Mount boat ---
            try {
                bot.mount(boatEntity);
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Mount timeout')), 5000);
                    bot.once('mount', () => { clearTimeout(timeout); resolve(); });
                });
            } catch(e) {
                skills.log(bot, 'Failed to mount boat: ' + e.message);
                return;
            }

            skills.log(bot, 'Riding boat toward x=' + x + ' z=' + z + '...');

            // --- 6. Navigate by looking at target + moving forward ---
            const startTime = Date.now();
            const TIMEOUT = 120000;
            let stuckCount = 0;
            let lastPos = bot.entity.position.clone();
            let landCount = 0;

            while (Date.now() - startTime < TIMEOUT) {
                if (!bot.vehicle) break;

                const pos = bot.entity.position;
                const ddx = x - pos.x;
                const ddz = z - pos.z;
                const dist = Math.sqrt(ddx * ddx + ddz * ddz);

                if (dist < 15) {
                    skills.log(bot, 'Close to target (' + Math.floor(dist) + ' blocks). Dismounting.');
                    break;
                }

                // Stuck detection
                if (pos.distanceTo(lastPos) < 0.3) {
                    stuckCount++;
                    if (stuckCount > 40) {
                        skills.log(bot, 'Boat stuck for ~4 seconds. Dismounting.');
                        break;
                    }
                } else {
                    stuckCount = 0;
                }
                lastPos = pos.clone();

                // Land detection: if block below is solid, we hit shore
                const below = bot.blockAt(pos.offset(0, -1, 0));
                if (below && below.name !== 'water' && below.boundingBox === 'block') {
                    landCount++;
                    if (landCount > 15) {
                        skills.log(bot, 'Reached land. Dismounting.');
                        break;
                    }
                } else {
                    landCount = 0;
                }

                // Steer: look at target then move forward
                const yaw = Math.atan2(-ddx, -ddz);
                await bot.look(yaw, 0);
                bot.moveVehicle(0, 1);

                await new Promise(r => setTimeout(r, 100));
            }

            // --- 7. Dismount ---
            if (bot.vehicle) {
                try {
                    bot.dismount();
                    await new Promise(r => setTimeout(r, 500));
                } catch(e) {}
            }

            // --- 8. Recover boat (attack to break, item_collecting will pick it up) ---
            try {
                const _recoverBoat = boatEntity && bot.entities[boatEntity.id];
                if (_recoverBoat) {
                    await bot.unequip('hand').catch(() => {});
                    for (let _bi = 0; _bi < 8; _bi++) {
                        if (!bot.entities[boatEntity.id]) break;
                        await bot.attack(bot.entities[boatEntity.id]);
                        await new Promise(r => setTimeout(r, 400));
                    }
                    skills.log(bot, 'Boat recovered.');
                }
            } catch(_be) {}

            const fp = bot.entity.position;
            const finalDist = Math.sqrt((x - fp.x) ** 2 + (z - fp.z) ** 2);
            if (finalDist < 20) {
                skills.log(bot, 'Boat navigation complete! Position: x=' + Math.floor(fp.x) + ' y=' + Math.floor(fp.y) + ' z=' + Math.floor(fp.z) + '. ' + Math.floor(finalDist) + ' blocks from target. Use !goToCoordinates for the last stretch.');
            } else {
                skills.log(bot, 'Boat navigation ended. Position: x=' + Math.floor(fp.x) + ' y=' + Math.floor(fp.y) + ' z=' + Math.floor(fp.z) + '. Still ' + Math.floor(finalDist) + ' blocks away. Try !boatTo again or !moveAway(100) to continue.');
            }
        })
    },
    // [mindaxis-patch:plan-commands-v2] マクロプランニングコマンド（critical guard付き）
    {
        name: '!planStatus',
        description: 'Show current macro plan status, goals, and steps.',
        perform: runAsAction(async (agent) => {
            const bot = agent.bot;
            try {
                const fs = await import('fs');
                const planPath = process.env.MINDAXIS_PLAN_PATH;
                if (!planPath || !fs.existsSync(planPath)) {
                    skills.log(bot, 'No plan file found.');
                    return;
                }
                const pd = JSON.parse(fs.readFileSync(planPath, 'utf8'));
                if (!pd || !pd.plans || pd.plans.length === 0) {
                    skills.log(bot, 'No plans available.');
                    return;
                }
                const ci = pd.currentPlanIndex || 0;
                let status = 'Plans:\n';
                pd.plans.forEach((p, i) => {
                    const marker = i === ci ? '>>>' : '   ';
                    status += marker + ' ' + (i+1) + '. ' + p.goal + ' [' + (p.status || 'pending') + ']\n';
                    if (i === ci && p.steps) {
                        p.steps.forEach((s, j) => {
                            status += '      ' + (s.done ? '[x]' : '[ ]') + ' ' + (j+1) + '. ' + s.step + '\n';
                        });
                    }
                });
                skills.log(bot, status);
            } catch(e) {
                skills.log(bot, 'Error reading plan: ' + e.message);
            }
        })
    },
    {
        name: '!planDone',
        description: 'Mark the current plan step as completed and advance to the next step.',
        perform: runAsAction(async (agent) => {
            const bot = agent.bot;
            try {
                const fs = await import('fs');
                const planPath = process.env.MINDAXIS_PLAN_PATH;
                if (!planPath || !fs.existsSync(planPath)) {
                    skills.log(bot, 'No plan file found.');
                    return;
                }
                const pd = JSON.parse(fs.readFileSync(planPath, 'utf8'));
                const ci = pd.currentPlanIndex || 0;
                const plan = pd.plans[ci];
                if (!plan || !plan.steps) {
                    skills.log(bot, 'No active plan.');
                    return;
                }
                const stepIdx = plan.steps.findIndex(s => !s.done);
                if (stepIdx < 0) {
                    skills.log(bot, 'All steps already done. Use !planNext to go to next plan.');
                    return;
                }
                plan.steps[stepIdx].done = true;
                const nextStep = plan.steps.findIndex(s => !s.done);
                if (nextStep < 0) {
                    plan.status = 'completed';
                    // Update achievements.json if this plan came from a roadmap phase
                    if (plan.phaseId) {
                        const achPath = process.env.MINDAXIS_ACHIEVEMENTS_PATH;
                        if (achPath) {
                            try {
                                const ach = fs.existsSync(achPath) ? JSON.parse(fs.readFileSync(achPath, 'utf8')) : { completed: [] };
                                if (!ach.completed.includes(plan.phaseId)) {
                                    ach.completed.push(plan.phaseId);
                                    fs.writeFileSync(achPath, JSON.stringify(ach, null, 2));
                                }
                            } catch (_) {}
                        }
                    }
                    skills.log(bot, 'Step ' + (stepIdx+1) + ' done! Plan 「' + plan.goal + '」completed!');
                } else {
                    skills.log(bot, 'Step ' + (stepIdx+1) + ' done! Next: ' + plan.steps[nextStep].step);
                }
                fs.writeFileSync(planPath, JSON.stringify(pd, null, 2));
            } catch(e) {
                skills.log(bot, 'Error updating plan: ' + e.message);
            }
        })
    },
    {
        name: '!planNext',
        description: 'Skip to the next macro plan goal.',
        perform: runAsAction(async (agent) => {
            const bot = agent.bot;
            try {
                const fs = await import('fs');
                const planPath = process.env.MINDAXIS_PLAN_PATH;
                if (!planPath || !fs.existsSync(planPath)) {
                    skills.log(bot, 'No plan file found.');
                    return;
                }
                const pd = JSON.parse(fs.readFileSync(planPath, 'utf8'));
                const ci = pd.currentPlanIndex || 0;
                if (ci + 1 >= pd.plans.length) {
                    skills.log(bot, 'No more plans. All plans completed!');
                    return;
                }
                pd.currentPlanIndex = ci + 1;
                pd.plans[ci + 1].status = 'in_progress';
                fs.writeFileSync(planPath, JSON.stringify(pd, null, 2));
                const next = pd.plans[ci + 1];
                skills.log(bot, 'Switched to plan: 「' + next.goal + '」 Reason: ' + (next.reason || ''));
            } catch(e) {
                skills.log(bot, 'Error switching plan: ' + e.message);
            }
        })
    },
    {
        name: '!planSkip',
        description: 'Skip the current step in the active plan.',
        perform: runAsAction(async (agent) => {
            const bot = agent.bot;
            try {
                const fs = await import('fs');
                const planPath = process.env.MINDAXIS_PLAN_PATH;
                if (!planPath || !fs.existsSync(planPath)) {
                    skills.log(bot, 'No plan file found.');
                    return;
                }
                const pd = JSON.parse(fs.readFileSync(planPath, 'utf8'));
                const ci = pd.currentPlanIndex || 0;
                const plan = pd.plans[ci];
                if (!plan || !plan.steps) {
                    skills.log(bot, 'No active plan.');
                    return;
                }
                const stepIdx = plan.steps.findIndex(s => !s.done);
                if (stepIdx < 0) {
                    skills.log(bot, 'No step to skip.');
                    return;
                }
                if (plan.steps[stepIdx].critical) {
                    skills.log(bot, 'Step ' + (stepIdx+1) + ' is CRITICAL and cannot be skipped. But do NOT over-prepare! Use !inventory to check what you already have, then !takeFromChest for missing items. Stone tools + food is enough to leave — use !planDone when you have minimum gear.');
                    return;
                }
                plan.steps[stepIdx].done = true;
                plan.steps[stepIdx].skipped = true;
                const nextStep = plan.steps.findIndex(s => !s.done);
                if (nextStep >= 0) {
                    skills.log(bot, 'Skipped step ' + (stepIdx+1) + '. Next: ' + plan.steps[nextStep].step);
                } else {
                    // スキップで全ステップが終わった場合は partial 扱い（achievements には記録しない）
                    plan.status = 'partial';
                    skills.log(bot, 'Skipped step ' + (stepIdx+1) + '. Plan ended with skipped steps — marked as partial, NOT completed. Objectives were not fully achieved.');
                }
                fs.writeFileSync(planPath, JSON.stringify(pd, null, 2));
            } catch(e) {
                skills.log(bot, 'Error skipping step: ' + e.message);
            }
        })
    },
    // [mindaxis-patch:expand-house] 家の拡張コマンド
    {
        name: '!expandHouse',
        description: 'Expand your house by extending one wall outward. Use when house is too cramped. Args: direction (north/south/east/west), amount (1-6 blocks, default 4).',
        params: {
            'direction': { type: 'string', description: 'Wall direction to extend: north, south, east, west' },
            'amount': { type: 'int', description: 'Blocks to extend (1-6)', domain: [1, 7] }
        },
        perform: runAsAction(async (agent, direction, amount) => {
            const bot = agent.bot;
            // 複数フェーズの建築は 90s 以上かかるので 300s の watchdog 延長を要請
            bot._requestWatchdogMs = 300000;
            const Vec3 = (await import('vec3')).default;
            const hs = bot._houseStructure;
            if (!hs || !hs.bounds) {
                skills.log(bot, 'No house detected! Run !scanHouse first.');
                return;
            }
            direction = (direction || 'east').toLowerCase().replace(/['"]/g, '');
            amount = parseInt(amount) || 4;
            if (amount < 1) amount = 1;
            if (amount > 6) amount = 6;
            if (!['north','south','east','west'].includes(direction)) {
                skills.log(bot, 'Invalid direction: ' + direction + '. Use north/south/east/west.');
                return;
            }

            const b = hs.bounds;
            const mat = hs.wallMaterial || 'oak_planks';
            const floorY = b.y;
            const roofY = b.roofY || (floorY + 4);
            const wallH = roofY - floorY - 1;
            const width = b.x2 - b.x1 + 1;
            const depth = b.z2 - b.z1 + 1;

            let spanLen;
            if (direction === 'north' || direction === 'south') { spanLen = width; }
            else { spanLen = depth; }
            const blocksNeeded = spanLen * amount + 2 * wallH * amount + spanLen * wallH + spanLen * amount;

            const inv = bot.inventory.items();
            let availMat = null;
            let availCount = 0;
            const tryMats = [mat, 'cobblestone', 'oak_planks', 'spruce_planks', 'birch_planks', 'stone', 'dirt'];
            for (const m of tryMats) {
                const count = inv.filter(i => i.name === m).reduce((s, i) => s + i.count, 0);
                if (count > 0) {
                    if (!availMat) { availMat = m; availCount = count; }
                }
            }

            // Phase 1 returns ~10 blocks, Phase 2/3 skip existing solid blocks — actual need is ~30% of estimate
            const minNeeded = Math.max(15, Math.floor(blocksNeeded * 0.3));
            if (!availMat || availCount < minNeeded) {
                skills.log(bot, 'Need ~' + minNeeded + ' ' + (availMat || mat) + ' to expand (est. ' + blocksNeeded + ' total). Have ' + availCount + '. Collect more building materials first!');
                return;
            }

            skills.log(bot, 'Expanding house ' + direction + ' by ' + amount + ' blocks using ' + (availMat || mat) + '...');
            bot._allowHouseDig = true;
            bot._repairMode = true;
            try {
            // Helper: check if a position already has a solid block (skip placing there)
            const hasSolid = (x, y, z) => {
                const bl = bot.blockAt(new Vec3(x, y, z));
                return bl && bl.name !== 'air' && bl.name !== 'cave_air' && bl.name !== 'void_air';
            };
            // Helper: placeBlock with error suppression (PathStopped 等で全体が中断しないように)
            const tryPlace = async (mat, x, y, z) => {
                try { await skills.placeBlock(bot, mat, x, y, z); } catch(_pe) {}
            };

            let newX1 = b.x1, newZ1 = b.z1, newX2 = b.x2, newZ2 = b.z2;
            if (direction === 'north') { newZ1 = b.z1 - amount; }
            if (direction === 'south') { newZ2 = b.z2 + amount; }
            if (direction === 'west') { newX1 = b.x1 - amount; }
            if (direction === 'east') { newX2 = b.x2 + amount; }

            const useMat = availMat || mat;

            // Phase 1: Break old wall
            skills.log(bot, 'Phase 1: Breaking old ' + direction + ' wall...');
            if (direction === 'north' || direction === 'south') {
                const wz = direction === 'north' ? b.z1 : b.z2;
                for (let wx = b.x1 + 1; wx < b.x2; wx++) {
                    for (let wy = floorY + 1; wy < roofY; wy++) {
                        const bl = bot.blockAt(new Vec3(wx, wy, wz));
                        if (bl && bl.name !== 'air' && bl.name !== 'cave_air' && !bl.name.includes('door')) {
                            try { await bot.dig(bl); } catch(e) {}
                        }
                    }
                }
                for (let wx = b.x1; wx <= b.x2; wx++) {
                    const rl = bot.blockAt(new Vec3(wx, roofY, wz));
                    if (rl && rl.name !== 'air') { try { await bot.dig(rl); } catch(e) {} }
                }
            } else {
                const wx = direction === 'west' ? b.x1 : b.x2;
                for (let wz = b.z1 + 1; wz < b.z2; wz++) {
                    for (let wy = floorY + 1; wy < roofY; wy++) {
                        const bl = bot.blockAt(new Vec3(wx, wy, wz));
                        if (bl && bl.name !== 'air' && bl.name !== 'cave_air' && !bl.name.includes('door')) {
                            try { await bot.dig(bl); } catch(e) {}
                        }
                    }
                }
                for (let wz = b.z1; wz <= b.z2; wz++) {
                    const rl = bot.blockAt(new Vec3(wx, roofY, wz));
                    if (rl && rl.name !== 'air') { try { await bot.dig(rl); } catch(e) {} }
                }
            }

            // Phase 2: Extend floor
            skills.log(bot, 'Phase 2: Extending floor...');
            if (direction === 'north' || direction === 'south') {
                const zStart = direction === 'north' ? newZ1 : b.z2 + 1;
                const zEnd = direction === 'north' ? b.z1 - 1 : newZ2;
                for (let fz = zStart; fz <= zEnd; fz++) {
                    for (let fx = newX1; fx <= newX2; fx++) {
                        await tryPlace(useMat, fx, floorY, fz);
                    }
                }
            } else {
                const xStart = direction === 'west' ? newX1 : b.x2 + 1;
                const xEnd = direction === 'west' ? b.x1 - 1 : newX2;
                for (let fx = xStart; fx <= xEnd; fx++) {
                    for (let fz = newZ1; fz <= newZ2; fz++) {
                        if (hasSolid(fx, floorY, fz)) continue; // already has floor block
                        await tryPlace(useMat, fx, floorY, fz);
                    }
                }
            }

            // Phase 3: Extend side walls
            skills.log(bot, 'Phase 3: Extending side walls...');
            if (direction === 'north' || direction === 'south') {
                const zStart = direction === 'north' ? newZ1 : b.z2 + 1;
                const zEnd = direction === 'north' ? b.z1 - 1 : newZ2;
                for (let fz = zStart; fz <= zEnd; fz++) {
                    for (let wy = floorY + 1; wy < roofY; wy++) {
                        await tryPlace(useMat, b.x1, wy, fz);
                        await tryPlace(useMat, b.x2, wy, fz);
                    }
                }
            } else {
                const xStart = direction === 'west' ? newX1 : b.x2 + 1;
                const xEnd = direction === 'west' ? b.x1 - 1 : newX2;
                for (let fx = xStart; fx <= xEnd; fx++) {
                    for (let wy = floorY + 1; wy < roofY; wy++) {
                        if (!hasSolid(fx, wy, b.z1)) await tryPlace(useMat, fx, wy, b.z1);
                        if (!hasSolid(fx, wy, b.z2)) await tryPlace(useMat, fx, wy, b.z2);
                    }
                }
            }

            // Phase 4: Build new wall
            skills.log(bot, 'Phase 4: Building new ' + direction + ' wall...');
            const doorOnThisWall = hs.door && (
                (direction === 'north' && hs.door.z === b.z1) ||
                (direction === 'south' && hs.door.z === b.z2) ||
                (direction === 'west' && hs.door.x === b.x1) ||
                (direction === 'east' && hs.door.x === b.x2)
            );
            if (direction === 'north' || direction === 'south') {
                const wz = direction === 'north' ? newZ1 : newZ2;
                for (let wx = newX1; wx <= newX2; wx++) {
                    for (let wy = floorY + 1; wy < roofY; wy++) {
                        if (doorOnThisWall && wx === hs.door.x && (wy - floorY) <= 2) continue;
                        await tryPlace(useMat, wx, wy, wz);
                    }
                }
            } else {
                const wx = direction === 'west' ? newX1 : newX2;
                for (let wz = newZ1; wz <= newZ2; wz++) {
                    for (let wy = floorY + 1; wy < roofY; wy++) {
                        if (doorOnThisWall && wz === hs.door.z && (wy - floorY) <= 2) continue;
                        await tryPlace(useMat, wx, wy, wz);
                    }
                }
            }

            // Phase 5: Extend roof
            // Phase 1 が旧壁の屋根ブロックを壊すので、旧壁位置も含めて再建する
            skills.log(bot, 'Phase 5: Extending roof...');
            if (direction === 'north' || direction === 'south') {
                const zStart = direction === 'north' ? newZ1 : b.z2; // b.z2: 旧南壁屋根も再建
                const zEnd = direction === 'north' ? b.z1 : newZ2;
                for (let fz = zStart; fz <= zEnd; fz++) {
                    for (let fx = newX1; fx <= newX2; fx++) {
                        if (!hasSolid(fx, roofY, fz)) await tryPlace(useMat, fx, roofY, fz);
                    }
                }
            } else {
                const xStart = direction === 'west' ? newX1 : b.x2; // b.x2: 旧東壁屋根も再建
                const xEnd = direction === 'west' ? b.x1 : newX2;
                for (let fx = xStart; fx <= xEnd; fx++) {
                    for (let fz = newZ1; fz <= newZ2; fz++) {
                        if (!hasSolid(fx, roofY, fz)) await tryPlace(useMat, fx, roofY, fz);
                    }
                }
            }

            // Phase 6: Relocate door if needed
            if (doorOnThisWall) {
                skills.log(bot, 'Phase 6: Relocating door...');
                let newDoorX = hs.door.x, newDoorZ = hs.door.z;
                if (direction === 'north') newDoorZ = newZ1;
                else if (direction === 'south') newDoorZ = newZ2;
                else if (direction === 'west') newDoorX = newX1;
                else if (direction === 'east') newDoorX = newX2;
                await tryPlace('oak_door', newDoorX, floorY + 1, newDoorZ);
            }

            // Phase 7: Re-scan and save new bounds
            skills.log(bot, 'Re-scanning expanded house...');
            const rescan = await skills.scanStructure(bot);

            // 拡張後の期待 bounds を計算（scan が失敗しても正しい bounds を保存）
            const newInteriorArea = (newX2 - newX1 - 1) * (newZ2 - newZ1 - 1);
            const furnitureCount = (hs.furniture || []).length;
            const newFreeTiles = newInteriorArea - furnitureCount;
            const expectedStructure = {
                bounds: { x1: newX1, z1: newZ1, x2: newX2, z2: newZ2, y: b.y, roofY: b.roofY },
                door: hs.door,
                wallMaterial: useMat,
                enclosed: !!rescan.enclosed,
                interior: { x1: newX1 + 1, z1: newZ1 + 1, x2: newX2 - 1, z2: newZ2 - 1 },
                interiorArea: newInteriorArea,
                furniture: hs.furniture || [],
                cramped: newFreeTiles <= 12 && furnitureCount >= 2,
            };
            bot._houseStructure = rescan.enclosed ? rescan : expectedStructure;

            // house.json に新しい bounds を保存（再起動後も反映されるように）
            try {
                const _fsExp = await import('fs');
                const _housePathExp = './bots/' + bot.username + '/house.json';
                const saved = rescan.enclosed ? {
                    bounds: rescan.bounds, door: rescan.door, wallMaterial: rescan.wallMaterial,
                    enclosed: true, interior: rescan.interior, interiorArea: rescan.interiorArea,
                    furniture: rescan.furniture || [], cramped: !!rescan.cramped,
                } : {
                    bounds: expectedStructure.bounds, door: expectedStructure.door,
                    wallMaterial: useMat, enclosed: false,
                    interior: expectedStructure.interior, interiorArea: newInteriorArea,
                    furniture: hs.furniture || [], cramped: expectedStructure.cramped,
                };
                _fsExp.writeFileSync(_housePathExp, JSON.stringify(saved, null, 2));
            } catch(_saveErr) { skills.log(bot, 'Warning: could not save house.json: ' + _saveErr.message); }

            if (rescan.enclosed) {
                skills.log(bot, 'House expanded! New size: ' + rescan.size + '. ' + rescan.description);
            } else {
                skills.log(bot, 'Expansion done but house may have gaps. Run !repairHouse to fix.');
            }

            } finally { bot._allowHouseDig = false; bot._repairMode = false; }
        }, false, 600)
    },
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            const _reached = await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
            // 重要エンティティに到達したらプロセス再起動に備えて位置を自動保存
            // [mindaxis-patch:village-save-distance] 既存保存地点から300ブロック以上離れている場合のみ保存
            // (同じ村へ戻るたびに上書きされるループを防止。Minecraft の村同士は通常300ブロック以上離れている)
            if (_reached && (entity_type === 'villager' || entity_type === 'wandering_trader')) {
                const _p = agent.bot.entity.position;
                const _name = entity_type === 'villager' ? 'village' : entity_type;
                // [mindaxis-patch:village-save-profession] ニットウィット/無職は village として保存しない
                if (entity_type === 'villager') {
                    const _nearV = Object.values(agent.bot.entities).find(e =>
                        e.name === 'villager' && e.position && e.position.distanceTo(_p) < 6
                    );
                    if (_nearV) {
                        const _pm = _nearV.metadata && Object.values(_nearV.metadata).find(v => v && typeof v === 'object' && 'villagerProfession' in v);
                        const _pid = _pm != null ? _pm.villagerProfession : -1;
                        if (_pid === 11 || _pid === 0) {
                            skills.log(agent.bot, `Found ${_pid === 11 ? 'nitwit' : 'unemployed'} villager (profId=${_pid}) — NOT a trading village. Do NOT call !rememberHere("village") here. Move away and search in a completely different direction for a real village with traders.`);
                            return;
                        }
                    }
                }
                const _existingLoc = agent.memory_bank.recallPlace(_name);
                if (!_existingLoc) {
                    agent.memory_bank.rememberPlace(_name, _p.x, _p.y, _p.z);
                    skills.log(agent.bot, `Auto-saved location as "${_name}" at (${Math.round(_p.x)}, ${Math.round(_p.y)}, ${Math.round(_p.z)}).`);
                } else {
                    const _dx = _p.x - _existingLoc[0], _dz = _p.z - _existingLoc[2];
                    const _dist = Math.sqrt(_dx * _dx + _dz * _dz);
                    if (_dist > 300) {
                        agent.memory_bank.rememberPlace(_name, _p.x, _p.y, _p.z);
                        skills.log(agent.bot, `Auto-updated "${_name}" at (${Math.round(_p.x)}, ${Math.round(_p.y)}, ${Math.round(_p.z)}) — prev was ${Math.round(_dist)} blocks away.`);
                    }
                }
            }
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!escapeEnclosure',
        description: 'Escape from an enclosed area (valley, cave, mountain trap). Uses flood-fill BFS to map the connected walkable space and navigate to its edge, then pillar-digs through obstacles if pathfinder fails. Use this when !moveAway or !goToCoordinates keep failing due to terrain.',
        params: {
            'radius': { type: 'float', description: 'Search radius in blocks (default 80).', domain: [20, 200] }
        },
        perform: runAsAction(async (agent, radius = 80) => {
            await skills.escapeEnclosure(agent.bot, radius);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            // [mindaxis-patch:rememberhere-nitwit-guard] 'village' はニットウィット/無職近くでは保存しない
            if (name === 'village') {
                const _p = agent.bot.entity.position;
                const _nearV = Object.values(agent.bot.entities).find(e =>
                    e.name === 'villager' && e.position && e.position.distanceTo(_p) < 8
                );
                if (_nearV) {
                    const _pm = _nearV.metadata && Object.values(_nearV.metadata).find(v => v && typeof v === 'object' && 'villagerProfession' in v);
                    const _pid = _pm != null ? _pm.villagerProfession : -1;
                    if (_pid === 11 || _pid === 0) {
                        return `Blocked: nearest villager is ${_pid === 11 ? 'nitwit' : 'unemployed'} (profId=${_pid}). This is NOT a trading village — do NOT save as "village". Move away and search in a different direction.`;
                    }
                }
            }
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
                skills.log(agent.bot, `No location named "${name}" saved.`);
                return;
            }
            // [mindaxis-patch:goto-remembered-nitwit-guard] 'village' がニットウィットエリアに近い場合はナビゲーション拒否
            if (name === 'village') {
                const _areas = agent.bot._nitwitAreas || [];
                const _close = _areas.find(na => Math.hypot(pos[0] - na.x, pos[2] - na.z) < 200);
                if (_close) {
                    agent.memory_bank.forgetPlace(name);
                    skills.log(agent.bot, `Blocked: saved "village" at (${Math.round(pos[0])}, ${Math.round(pos[2])}) is within 200 blocks of blacklisted nitwit area (${_close.x}, ?, ${_close.z}). Entry deleted — search in a different direction.`);
                    return;
                }
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            await skills.collectBlock(agent.bot, type, num);
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            // [mindaxis-patch:smelt-no-cleankill] cleanKill 不要（mineflayer がインベントリ自動更新）
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            // [mindaxis-patch:placehere-settle] ピラージャンプ修正
            const Vec3 = (await import('vec3')).default;
            let bot = agent.bot;
            // 家の中で建材ブロック配置を防止（家具のみ許可）
            {
                const _hs = bot._houseStructure;
                if (_hs && _hs.bounds) {
                    const _p = bot.entity.position;
                    const _b = _hs.bounds;
                    const _inHouse = _p.x > _b.x1 && _p.x < _b.x2 && _p.z > _b.z1 && _p.z < _b.z2
                                   && _p.y >= _b.y && _p.y <= (_b.roofY || _b.y + 4);
                    if (_inHouse) {
                        const _furniture = ['torch','soul_torch','lantern','chest','trapped_chest','barrel',
                            'furnace','blast_furnace','smoker','crafting_table','anvil','enchanting_table',
                            'brewing_stand','bed','white_bed','red_bed','blue_bed','green_bed','yellow_bed',
                            'black_bed','brown_bed','cyan_bed','gray_bed','light_blue_bed','light_gray_bed',
                            'lime_bed','magenta_bed','orange_bed','pink_bed','purple_bed',
                            'flower_pot','painting','item_frame','armor_stand','campfire','soul_campfire',
                            'bookshelf','jukebox','note_block','bell','lectern','loom','grindstone',
                            'stonecutter','cartography_table','smithing_table','composter','beehive',
                            'respawn_anchor','lodestone'];
                        if (!_furniture.some(f => type.includes(f))) {
                            skills.log(bot, `Blocked placing ${type} inside house (not furniture). Use placeHere outside.`);
                            return;
                        }
                    }
                }
            }
            // 浮遊中なら着地を待つ
            if (!bot.entity.onGround) {
                for (let i = 0; i < 20 && !bot.entity.onGround; i++) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }
            // トーチ等の非固体ブロックは従来通り足元に配置
            const nonSolid = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail',
                'detector_rail', 'powered_rail', 'activator_rail', 'tripwire_hook', 'string'];
            if (nonSolid.some(n => type.includes(n))) {
                let pos = bot.entity.position;
                await skills.placeBlock(bot, type, pos.x, pos.y, pos.z);
                return;
            }
            // 固体ブロック: インベントリ確認
            let block_item = bot.inventory.items().find(item => item.name === type);
            if (!block_item) {
                skills.log(bot, `Don't have any ${type} to place.`);
                return;
            }
            await bot.equip(block_item, 'hand');
            // 足元のブロックを取得（配置の参照ブロック）
            let pos = bot.entity.position;
            let feetY = Math.floor(pos.y);
            let standBlock = bot.blockAt(new Vec3(Math.floor(pos.x), feetY - 1, Math.floor(pos.z)));
            // 足元が空気の場合: さらに下を探す（落下中等）
            if (!standBlock || standBlock.name === 'air' || standBlock.name === 'cave_air') {
                for (let dy = 2; dy <= 5; dy++) {
                    let b = bot.blockAt(new Vec3(Math.floor(pos.x), feetY - dy, Math.floor(pos.z)));
                    if (b && b.name !== 'air' && b.name !== 'cave_air') {
                        standBlock = b;
                        break;
                    }
                }
            }
            if (!standBlock || standBlock.name === 'air' || standBlock.name === 'cave_air') {
                skills.log(bot, `Cannot pillar: no solid block below.`);
                return;
            }
            // [mindaxis-patch:placehere-water-detect] 水中/水面: 足元 solid base に直置き
            const _phIsWater = n => n === 'water' || n === 'flowing_water';
            const _phFeetBlock = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
            if (_phFeetBlock && _phIsWater(_phFeetBlock.name)) {
                let _phBase = null;
                for (let _phDy = 0; _phDy <= 10; _phDy++) {
                    const _phB = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) - _phDy, Math.floor(pos.z)));
                    if (_phB && !_phIsWater(_phB.name) && _phB.name !== 'air' && _phB.name !== 'cave_air') {
                        _phBase = _phB;
                        break;
                    }
                }
                if (_phBase) {
                    try {
                        await bot.lookAt(_phBase.position.offset(0.5, 1.0, 0.5));
                        await bot.placeBlock(_phBase, new Vec3(0, 1, 0));
                        skills.log(bot, `Placed ${type} in water at ${_phBase.position.offset(0, 1, 0)}.`);
                    } catch (_phErr) {
                        skills.log(bot, `Cannot place in water: ${_phErr.message}`);
                    }
                } else {
                    skills.log(bot, `Cannot placeHere: no solid base under water.`);
                }
                return;
            }
            // ジャンプしてピラー配置
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 400));
            bot.setControlState('jump', false);
            try {
                // 足元の固体ブロックの上面に配置
                await bot.lookAt(standBlock.position.offset(0.5, 1.0, 0.5));
                await bot.placeBlock(standBlock, new Vec3(0, 1, 0));
                skills.log(bot, `Placed ${type} at ${standBlock.position.offset(0, 1, 0)} (pillar jump).`);
            } catch (err) {
                // [mindaxis-patch:placehere-no-hang] skills.placeBlock は水中でハングするため使わない
                skills.log(bot, `Pillar place failed: ${err.message}. Try !goToSurface first.`);
            }
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
            // [mindaxis-patch:villager-blacklist-persist] bot._blockedVillagerIds は history.save() で自動的に memory.json へ永続化される
            // (history.js の save/load に blocked_nitwit_ids フィールドを追加済み)
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
];
