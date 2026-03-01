import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import settings from "../../../settings.js";

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;

export function log(bot, message) {
    bot.output += message + '\n';
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

async function equipHighestAttack(bot) {
    let weapons = bot.inventory.items().filter(item => item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe')));
    if (weapons.length === 0)
        weapons = bot.inventory.items().filter(item => item.name.includes('pickaxe') || item.name.includes('shovel'));
    if (weapons.length === 0)
        return;
    weapons.sort((a, b) => a.attackDamage < b.attackDamage);
    let weapon = weapons[0];
    if (weapon)
        await bot.equip(weapon, 'hand');
}

export async function craftRecipe(bot, itemName, num=1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    let placedTable = false;

    if (mc.getItemCraftingRecipes(itemName).length == 0) {
        log(bot, `${itemName} is either not an item, or it does not have a crafting recipe!`);
        return false;
    }

    // get recipes that don't require a crafting table
    let recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, null); 
    let craftingTable = null;
    const craftingTableRange = 16;
    placeTable: if (!recipes || recipes.length === 0) {
        recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, true);
        if(!recipes || recipes.length === 0) break placeTable; //Don't bother going to the table if we don't have the required resources.

        // Look for crafting table
        craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
        if (craftingTable === null){

            // Try to place crafting table
            let hasTable = world.getInventoryCounts(bot)['crafting_table'] > 0;
            if (hasTable) {
                let pos = world.getNearestFreeSpace(bot, 1, 6);
                await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
                craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
                if (craftingTable) {
                    recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
                    placedTable = true;
                }
            }
            else {
                log(bot, `Crafting ${itemName} requires a crafting table.`)
                return false;
            }
        }
        else {
            recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
        }
    }
    if (!recipes || recipes.length === 0) {
        log(bot, `You do not have the resources to craft a ${itemName}. It requires: ${Object.entries(mc.getItemCraftingRecipes(itemName)[0][0]).map(([key, value]) => `${key}: ${value}`).join(', ')}.`);
        if (placedTable) {
            await collectBlock(bot, 'crafting_table', 1);
        }
        return false;
    }
    
    if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
        await goToNearestBlock(bot, 'crafting_table', 4, craftingTableRange);
    }

    const recipe = recipes[0];
    console.log('crafting...');
    //Check that the agent has sufficient items to use the recipe `num` times.
    const inventory = world.getInventoryCounts(bot); //Items in the agents inventory
    const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe); //Items required to use the recipe once.
    const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);
    
    // [mindaxis-patch:craft-partial-success] 材料不足で全量作れない場合も成功として扱う（ループ防止）
    if (craftLimit.num === 0) {
        log(bot, `You do not have enough materials to craft ${itemName}. Need: ${craftLimit.limitingResource}.`);
        if (placedTable) await collectBlock(bot, 'crafting_table', 1);
        return false;
    }
    await bot.craft(recipe, Math.min(craftLimit.num, num), craftingTable);
    log(bot, `Successfully crafted ${itemName}, you now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    if (placedTable) {
        await collectBlock(bot, 'crafting_table', 1);
    }

    //Equip any armor the bot may have crafted.
    //There is probablly a more efficient method than checking the entire inventory but this is all mineflayer-armor-manager provides. :P
    bot.armorManager.equipAll(); 

    return true;
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num=1) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/

    if (!mc.isSmeltable(itemName)) {
        log(bot, `Cannot smelt ${itemName}. Hint: make sure you are smelting the 'raw' item.`);
        return false;
    }

    let placedFurnace = false;
    let furnaceBlock = undefined;
    const furnaceRange = 16;
    furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
    if (!furnaceBlock){
        // Try to place furnace
        let hasFurnace = world.getInventoryCounts(bot)['furnace'] > 0;
        if (hasFurnace) {
            let pos = world.getNearestFreeSpace(bot, 1, furnaceRange);
            await placeBlock(bot, 'furnace', pos.x, pos.y, pos.z);
            furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
            placedFurnace = true;
        }
    }
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby and you have no furnace.`)
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, furnaceRange);
    }
    /* [mindaxis-patch:no-unstuck-pause] */ // unstuck mode deleted
    await bot.lookAt(furnaceBlock.position);

    console.log('smelting...');
    const furnace = await bot.openFurnace(furnaceBlock);
    // check if the furnace is already smelting something
    let input_item = furnace.inputItem();
    if (input_item && input_item.type !== mc.getItemId(itemName) && input_item.count > 0) {
        // TODO: check if furnace is currently burning fuel. furnace.fuel is always null, I think there is a bug.
        // This only checks if the furnace has an input item, but it may not be smelting it and should be cleared.
        log(bot, `The furnace is currently smelting ${mc.getItemName(input_item.type)}.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }
    // check if the bot has enough items to smelt
    let inv_counts = world.getInventoryCounts(bot);
    if (!inv_counts[itemName] || inv_counts[itemName] < num) {
        log(bot, `You do not have enough ${itemName} to smelt.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }

    // fuel the furnace /* [mindaxis-patch:smelt-fuel-overlap] */
    let fuelUsed = 0;
    if (!furnace.fuelItem()) {
        let fuel = mc.getSmeltingFuel(bot);
        if (!fuel) {
            log(bot, `You have no fuel to smelt ${itemName}, you need coal, charcoal, or wood.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        log(bot, `Using ${fuel.name} as fuel.`);

        let put_fuel = Math.ceil(num / mc.getFuelSmeltOutput(fuel.name));

        // When fuel and input are the same item, we need enough for both
        if (fuel.name === itemName) {
            const totalNeeded = put_fuel + num;
            if (fuel.count < totalNeeded) {
                // Reduce num to fit available items: available = fuel.count, need put_fuel + num
                // Solve: put_fuel = ceil(num / output), so num + ceil(num/output) <= fuel.count
                // Approximate: num <= fuel.count / (1 + 1/output)
                const output = mc.getFuelSmeltOutput(fuel.name);
                let maxNum = Math.floor(fuel.count / (1 + 1/output));
                if (maxNum < 1) {
                    log(bot, `You don't have enough ${fuel.name} to smelt and fuel. Need at least ${totalNeeded}, have ${fuel.count}.`);
                    if (placedFurnace)
                        await collectBlock(bot, 'furnace', 1);
                    return false;
                }
                log(bot, `Not enough ${fuel.name} for both fuel and smelting ${num}. Reducing to ${maxNum}.`);
                num = maxNum;
                put_fuel = Math.ceil(num / output);
            }
        } else if (fuel.count < put_fuel) {
            log(bot, `You don't have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${put_fuel}.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        try {
            await furnace.putFuel(fuel.type, null, put_fuel);
            fuelUsed = put_fuel;
        } catch (e) {
            log(bot, `Failed to add fuel: ${e.message}`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        log(bot, `Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`);
        console.log(`Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`)
    }
    // put the items in the furnace
    try {
        await furnace.putInput(mc.getItemId(itemName), null, num);
    } catch (e) {
        log(bot, `Failed to add input to furnace: ${e.message}`);
        // Try to recover fuel
        if (furnace.fuelItem()) {
            try { await furnace.takeFuel(); } catch(_) {}
        }
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }
    // wait for the items to smelt
    let total = 0;
    let smelted_item = null;
    await new Promise(resolve => setTimeout(resolve, 200));
    let last_collected = Date.now();
    while (total < num) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (furnace.outputItem()) {
            smelted_item = await furnace.takeOutput();
            if (smelted_item) {
                total += smelted_item.count;
                last_collected = Date.now();
            }
        }
        if (Date.now() - last_collected > 11000) {
            break; // if nothing has been collected in 11 seconds, stop
        }
        if (bot.interrupt_code) {
            break;
        }
    }
    // take all remaining in input/fuel slots
    if (furnace.inputItem()) {
        await furnace.takeInput();
    }
    if (furnace.fuelItem()) {
        await furnace.takeFuel();
    }

    await bot.closeWindow(furnace);

    if (placedFurnace) {
        await collectBlock(bot, 'furnace', 1);
    }
    if (total === 0) {
        log(bot, `Failed to smelt ${itemName}.`);
        return false;
    }
    if (total < num) {
        log(bot, `Only smelted ${total} ${mc.getItemName(smelted_item.type)}.`);
        return false;
    }
    log(bot, `Successfully smelted ${itemName}, got ${total} ${mc.getItemName(smelted_item.type)}.`);
    return true;
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    let furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
    if (!furnaceBlock) {
        log(bot, `No furnace nearby to clear.`);
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, 32);
    }

    console.log('clearing furnace...');
    const furnace = await bot.openFurnace(furnaceBlock);
    console.log('opened furnace...')
    // take the items out of the furnace
    let smelted_item, intput_item, fuel_item;
    if (furnace.outputItem())
        smelted_item = await furnace.takeOutput();
    if (furnace.inputItem())
        intput_item = await furnace.takeInput();
    if (furnace.fuelItem())
        fuel_item = await furnace.takeFuel();
    console.log(smelted_item, intput_item, fuel_item)
    let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
    let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
    let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
    log(bot, `Cleared furnace, received ${smelted_name}, ${input_name}, and ${fuel_name}.`);
    return true;

}


export async function attackNearest(bot, mobType, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    if (mobType === 'drowned' || mobType === 'cod' || mobType === 'salmon' || mobType === 'tropical_fish' || mobType === 'squid')
        bot.modes.pause('self_preservation'); // so it can go underwater. TODO: have an drowning mode so we don't turn off all self_preservation
    const mob = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, 'Could not find any '+mobType+' to attack.');
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    let pos = entity.position;
    await equipHighestAttack(bot)

    if (!kill) {
        if (bot.entity.position.distanceTo(pos) > 5) {
            console.log('moving to mob...')
            await goToPosition(bot, pos.x, pos.y, pos.z);
        }
        console.log('attacking mob...')
        await bot.attack(entity);
    }
    else {
        bot.pvp.attack(entity);
        while (world.getNearbyEntities(bot, 24).includes(entity)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (bot.interrupt_code) {
                bot.pvp.stop();
                return false;
            }
        }
        log(bot, `Successfully killed ${entity.name}.`);
        await pickupNearbyItems(bot);
        return true;
    }
}

export async function defendSelf(bot, range=9) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 8.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let attacked = false;
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), range);
    while (enemy) {
        await equipHighestAttack(bot);
        if (bot.entity.position.distanceTo(enemy.position) >= 4 && enemy.name !== 'creeper' && enemy.name !== 'phantom') {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                await bot.pathfinder.goto(new pf.goals.GoalFollow(enemy, 3.5), true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        if (bot.entity.position.distanceTo(enemy.position) <= 2) {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                let inverted_goal = new pf.goals.GoalInvert(new pf.goals.GoalFollow(enemy, 2));
                await bot.pathfinder.goto(inverted_goal, true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        bot.pvp.attack(enemy);
        attacked = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), range);
        if (bot.interrupt_code) {
            bot.pvp.stop();
            return false;
        }
    }
    bot.pvp.stop();
    if (attacked)
        log(bot, `Successfully defended self.`);
    else
        log(bot, `No enemies nearby to defend self from.`);
    return attacked;
}



export async function collectBlock(bot, blockType, num=1, exclude=null) {
    // [mindaxis-patch:collect-timeout] 収集開始時のインベントリを記録
    const _startInvCount = bot.inventory.items().filter(i => i.name === blockType || i.name.includes(blockType.replace('_log', '_planks'))).reduce((s, i) => s + i.count, 0);
    const _collectStartTime = Date.now();
    const _collectTimeout = 60000; // 60秒タイムアウト
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @param {list} exclude, a list of positions to exclude from the search. Defaults to null.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    let blocktypes = [blockType];
    if (blockType === 'coal' || blockType === 'diamond' || blockType === 'emerald' || blockType === 'iron' || blockType === 'gold' || blockType === 'lapis_lazuli' || blockType === 'redstone')
        blocktypes.push(blockType+'_ore');
    if (blockType.endsWith('ore'))
        blocktypes.push('deepslate_'+blockType);
    if (blockType === 'dirt')
        blocktypes.push('grass_block');
    if (blockType === 'cobblestone')
        blocktypes.push('stone');
    const isLiquid = blockType === 'lava' || blockType === 'water';

    let collected = 0;

    const movements = new pf.Movements(bot);
    movements.dontMineUnderFallingBlock = false;
    // [mindaxis-patch:collect-wood-flow] 木の採集時は dontCreateFlow を無効化（水辺の木が取れなくなるため）
    const _woodTypes = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'];
    movements.dontCreateFlow = !_woodTypes.some(w => blocktypes.includes(w));

    // Blocks to ignore safety for, usually next to lava/water
    const unsafeBlocks = ['obsidian'];

    for (let i=0; i<num; i++) {
        let blocks = world.getNearestBlocksWhere(bot, block => {
            if (!blocktypes.includes(block.name)) {
                return false;
            }
            if (exclude) {
                for (let position of exclude) {
                    if (block.position.x === position.x && block.position.y === position.y && block.position.z === position.z) {
                        return false;
                    }
                }
            }
            if (isLiquid) {
                // collect only source blocks
                return block.metadata === 0;
            }
            
            // [mindaxis-patch:collect-no-submerged-v5] 水没ブロック除外 + デバッグログ
            if (!block.position) return blocktypes.includes(block.name); // パレットチェック時は名前のみ確認
            const _cbIsWater = n => n && (n.name === 'water' || n.name === 'flowing_water');
            const _cbAbove1 = bot.blockAt(block.position.offset(0, 1, 0));
            const _cbAbove2 = bot.blockAt(block.position.offset(0, 2, 0));
            if (_cbIsWater(_cbAbove1) && _cbIsWater(_cbAbove2)) { console.log('[collect-dbg] SKIP submerged: ' + block.name + ' ' + block.position); return false; }
            const _cbBelow = bot.blockAt(block.position.offset(0, -1, 0));
            if (_cbIsWater(_cbBelow)) { console.log('[collect-dbg] SKIP water-below: ' + block.name + ' ' + block.position); return false; }
            const _cbAdj = [
                bot.blockAt(block.position.offset(1, 1, 0)),
                bot.blockAt(block.position.offset(-1, 1, 0)),
                bot.blockAt(block.position.offset(0, 1, 1)),
                bot.blockAt(block.position.offset(0, 1, -1)),
            ].filter(_cbIsWater).length;
            if (_cbIsWater(_cbAbove1) && _cbAdj >= 2) { console.log('[collect-dbg] SKIP water-adj: ' + block.name + ' ' + block.position); return false; }
            const _stbOk = movements.safeToBreak(block) || unsafeBlocks.includes(block.name);
            if (!_stbOk) { console.log('[collect-dbg] SKIP safeToBreak: ' + block.name + ' ' + block.position); }
            return _stbOk;
        }, 64, 1);

        if (blocks.length === 0) {
            if (collected === 0)
                log(bot, `No ${blockType} nearby to collect.`);
            else
                log(bot, `No more ${blockType} nearby to collect.`);
            break;
        }
        const block = blocks[0];
        await bot.tool.equipForBlock(block);
        if (isLiquid) {
            const bucket = bot.inventory.items().find(item => item.name === 'bucket');
            if (!bucket) {
                log(bot, `Don't have bucket to harvest ${blockType}.`);
                return false;
            }
            await bot.equip(bucket, 'hand');
        }
        const itemId = bot.heldItem ? bot.heldItem.type : null
        if (!block.canHarvest(itemId)) {
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }
        try {
            let success = false;
            if (isLiquid) {
                success = await useToolOnBlock(bot, 'bucket', block);
            }
            else if (mc.mustCollectManually(blockType)) {
                await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                await bot.dig(block);
                await pickupNearbyItems(bot);
                success = true;
            }
            else {
                // [mindaxis-patch:collect-direct-dig] 到達範囲内なら直接掘る（GoalLookAtBlock振動回避）
                const _blockCenter = block.position.offset(0.5, 0.5, 0.5);
                const _digDist = bot.entity.position.distanceTo(_blockCenter);
                if (_digDist <= 4.5) {
                    await bot.dig(block);
                    await pickupNearbyItems(bot);
                } else {
                    await bot.collectBlock.collect(block);
                }
                success = true;
            }
            if (success)
                collected++;
            await autoLight(bot);
        }
        catch (err) {
            if (err.name === 'NoChests') {
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                break;
            }
            else {
                log(bot, `Failed to collect ${blockType}: ${err}.`);
                continue;
            }
        }
        
        if (bot.interrupt_code)
            break;  
    }
    log(bot, `Collected ${collected} ${blockType}.`);
    // [mindaxis-patch:location-memory-record] 資源の群生地を記録
    if (collected > 0) {
        try {
            const _fs2 = await import('fs');
            const _memPath2 = './bots/' + bot.username + '/location_memory.json';
            let _lm2 = {};
            try { _lm2 = JSON.parse(_fs2.readFileSync(_memPath2, 'utf8')); } catch(_) {}
            if (!_lm2.resources) _lm2.resources = {};
            const _rem = world.getNearestBlocks(bot, blockType, 64, 30);
            const _bp = bot.entity.position;
            if (_rem.length >= 3) {
                const _cx = Math.round(_rem.reduce((s,b)=>s+b.position.x,0)/_rem.length);
                const _cy = Math.round(_rem.reduce((s,b)=>s+b.position.y,0)/_rem.length);
                const _cz = Math.round(_rem.reduce((s,b)=>s+b.position.z,0)/_rem.length);
                if (!_lm2.resources[blockType]) _lm2.resources[blockType] = [];
                const _exLoc = _lm2.resources[blockType].find(l => Math.abs(l.x-_cx)<40 && Math.abs(l.z-_cz)<40);
                if (_exLoc) { _exLoc.count = _rem.length; _exLoc.lastSeen = Date.now(); }
                else _lm2.resources[blockType].push({x:_cx, y:_cy, z:_cz, count:_rem.length, lastSeen:Date.now()});
                log(bot, `Memorized: ${blockType} at (${_cx},${_cz}), ${_rem.length} remaining.`);
            } else {
                if (_lm2.resources[blockType]) {
                    _lm2.resources[blockType] = _lm2.resources[blockType].filter(l => Math.abs(l.x-_bp.x)>=40 || Math.abs(l.z-_bp.z)>=40);
                    if (_lm2.resources[blockType].length === 0) delete _lm2.resources[blockType];
                }
            }
            _fs2.writeFileSync(_memPath2, JSON.stringify(_lm2, null, 2), 'utf8');
        } catch(_lmErr2) {}
    }
    return collected > 0;
}

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const distance = 8;
    const getNearestItem = bot => bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) < distance);
    let nearestItem = getNearestItem(bot);
    let pickedUp = 0;
    while (nearestItem) {
        let movements = new pf.Movements(bot);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
        await goToGoal(bot, new pf.goals.GoalFollow(nearestItem, 1));
        await new Promise(resolve => setTimeout(resolve, 200));
        let prev = nearestItem;
        nearestItem = getNearestItem(bot);
        if (prev === nearestItem) {
            break;
        }
        pickedUp++;
    }
    log(bot, `Picked up ${pickedUp} items.`);
    return true;
}


export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (x == null || y == null || z == null) throw new Error('Invalid position to break block at.');
    let block = bot.blockAt(Vec3(x, y, z));
    if (block.name !== 'air' && block.name !== 'water' && block.name !== 'lava') {
        if (bot.modes.isOn('cheat')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            let movements = new pf.Movements(bot);
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            bot.pathfinder.setMovements(movements);
            await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        }
        if (bot.game.gameMode !== 'creative') {
            await bot.tool.equipForBlock(block);
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        await bot.dig(block, true);
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    else {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}


export async function placeBlock(bot, blockType, x, y, z, placeOn='bottom', dontCheat=false) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place, which can be a block or item name.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${target_dest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            let block = bot.inventory.items().find(item => item.name === blockType);
            if (!block) {
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // insert wall_ before torch
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }
        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }
        if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        if (blockType.includes('bed'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        log(bot, `Used /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    let item_name = blockType;
    if (item_name == "redstone_wire")
        item_name = "redstone";
    else if (item_name === 'water') {
        item_name = 'water_bucket';
    }
    else if (item_name === 'lava') {
        item_name = 'lava_bucket';
    }
    let block_item = bot.inventory.items().find(item => item.name === item_name);
    if (!block_item && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(item_name, 1)); // 36 is first hotbar slot
        block_item = bot.inventory.items().find(item => item.name === item_name);
    }
    if (!block_item) {
        log(bot, `Don't have any ${item_name} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (targetBlock.name === blockType || (targetBlock.name === 'grass_block' && blockType === 'dirt')) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern'];
    if (!empty_blocks.includes(targetBlock.name)) {
        log(bot, `${targetBlock.name} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (!empty_blocks.includes(block.name)) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 
        'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket', 'string'];
    if (!dont_move_for.includes(item_name) && (pos.distanceTo(targetBlock.position) < 1.1 || pos_above.distanceTo(targetBlock.position) < 1.1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(inverted_goal);
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        let movements = new pf.Movements(bot);
        bot.pathfinder.setMovements(movements);
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        if (item_name.includes('bucket')) {
            await useToolOnBlock(bot, item_name, buildOffBlock);
        }
        else {
            await bot.equip(block_item, 'hand');
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5));
            await bot.placeBlock(buildOffBlock, faceVec);
            log(bot, `Placed ${blockType} at ${target_dest}.`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return true;
        }
    } catch (err) {
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function equip(bot, itemName) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    if (itemName === 'hand') {
        await bot.unequip('hand');
        log(bot, `Unequipped hand.`);
        return true;
    }
    let item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
    if (!item) {
        if (bot.game.gameMode === "creative") {
            await bot.creative.setInventorySlot(36, mc.makeItem(itemName, 1));
            item = bot.inventory.items().find(item => item.name === itemName);
        }
        else {
            log(bot, `You do not have any ${itemName} to equip.`);
            return false;
        }
    }
    if (itemName.includes('leggings')) {
        await bot.equip(item, 'legs');
    }
    else if (itemName.includes('boots')) {
        await bot.equip(item, 'feet');
    }
    else if (itemName.includes('helmet')) {
        await bot.equip(item, 'head');
    }
    else if (itemName.includes('chestplate') || itemName.includes('elytra')) {
        await bot.equip(item, 'torso');
    }
    else if (itemName.includes('shield')) {
        await bot.equip(item, 'off-hand');
    }
    else {
        await bot.equip(item, 'hand');
    }
    log(bot, `Equipped ${itemName}.`);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = bot.inventory.items().find(item => item.name === itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

export async function putInChest(bot, itemName, num=-1) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to put in the chest.
     * @param {number} num, the number of items to put in the chest. Defaults to -1, which puts all items.
     * @returns {Promise<boolean>} true if the item was put in the chest, false otherwise.
     * @example
     * await skills.putInChest(bot, "oak_log");
     **/
    // [mindaxis-patch:chest-house-priority] 家レベルのチェストを優先
    let chest = null;
    {
        const _allChests = world.getNearestBlocks(bot, 'chest', 32, 10);
        const _hs = bot._houseStructure;
        if (_hs && _hs.bounds && _allChests.length > 1) {
            const _fy = _hs.bounds.y || 69;
            const _houseChests = _allChests.filter(c => c.position.y >= _fy && c.position.y <= _fy + 2);
            chest = _houseChests.length > 0 ? _houseChests[0] : _allChests[0];
        } else {
            chest = _allChests.length > 0 ? _allChests[0] : null;
        }
    }
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    let item = bot.inventory.items().find(item => item.name === itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    let to_put = num === -1 ? item.count : Math.min(num, item.count);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    await chestContainer.deposit(item.type, null, to_put);
    // [mindaxis-patch:chest-snapshot] 家のチェスト操作後に中身を記録（上書き同期）
    try {
        const _hs = bot._houseStructure;
        const _isHomeChest = _hs && _hs.bounds && chest.position.y >= (_hs.bounds.y || 69) && chest.position.y <= (_hs.bounds.y || 69) + 2;
        if (_isHomeChest) {
            const _chestItems = chestContainer.containerItems();
            const _chestNames = [...new Set(_chestItems.map(i => i.name))];
            bot._chestSummary = _chestNames;
            const _fs = await import('fs');
            _fs.writeFileSync('./bots/' + bot.username + '/chest_summary.json', JSON.stringify({ items: _chestNames, updatedAt: new Date().toISOString() }, null, 2));
        }
    } catch(_cse) {}
    await chestContainer.close();
    log(bot, `Successfully put ${to_put} ${itemName} in the chest.`);
    return true;
}

export async function takeFromChest(bot, itemName, num=-1) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to take from the chest.
     * @param {number} num, the number of items to take from the chest. Defaults to -1, which takes all items.
     * @returns {Promise<boolean>} true if the item was taken from the chest, false otherwise.
     * @example
     * await skills.takeFromChest(bot, "oak_log");
     * **/
    // [mindaxis-patch:chest-take-house-priority] 家レベルのチェストを優先（地下チェスト除外）
    let chest = null;
    {
        const _allChests = world.getNearestBlocks(bot, 'chest', 32, 10);
        const _hs = bot._houseStructure;
        if (_hs && _hs.bounds) {
            const _fy = _hs.bounds.y || 69;
            const _houseChests = _allChests.filter(c => c.position.y >= _fy - 2 && c.position.y <= _fy + 3);
            chest = _houseChests.length > 0 ? _houseChests[0] : null;
        } else {
            chest = _allChests.length > 0 ? _allChests[0] : null;
        }
    }
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    
    // Find all matching items in the chest
    let matchingItems = chestContainer.containerItems().filter(item => item.name === itemName);
    if (matchingItems.length === 0) {
        log(bot, `Could not find any ${itemName} in the chest.`);
        await chestContainer.close();
        return false;
    }
    
    let totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
    let remaining = num === -1 ? totalAvailable : Math.min(num, totalAvailable);
    let totalTaken = 0;
    
    // Take items from each slot until we've taken enough or run out
    for (const item of matchingItems) {
        if (remaining <= 0) break;
        
        let toTakeFromSlot = Math.min(remaining, item.count);
        await chestContainer.withdraw(item.type, null, toTakeFromSlot);
        
        totalTaken += toTakeFromSlot;
        remaining -= toTakeFromSlot;
    }
    
    // [mindaxis-patch:chest-take-snapshot] 家のチェスト操作後に中身を記録
    try {
        const _hs2 = bot._houseStructure;
        const _isHome2 = _hs2 && _hs2.bounds && chest.position.y >= (_hs2.bounds.y || 69) && chest.position.y <= (_hs2.bounds.y || 69) + 2;
        if (_isHome2) {
            const _ci2 = chestContainer.containerItems();
            const _cn2 = [...new Set(_ci2.map(i => i.name))];
            bot._chestSummary = _cn2;
            const _fs2 = await import('fs');
            _fs2.writeFileSync('./bots/' + bot.username + '/chest_summary.json', JSON.stringify({ items: _cn2, updatedAt: new Date().toISOString() }, null, 2));
        }
    } catch(_cs2) {}
    await chestContainer.close();
    log(bot, `Successfully took ${totalTaken} ${itemName} from the chest.`);
    return totalTaken > 0;
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
     * @example
     * await skills.viewChest(bot);
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    let items = chestContainer.containerItems();
    if (items.length === 0) {
        log(bot, `The chest is empty.`);
    }
    else {
        log(bot, `The chest contains:`);
        for (let item of items) {
            log(bot, `${item.count} ${item.name}`);
        }
    }
    await chestContainer.close();
    return true;
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (itemName) {
        item = bot.inventory.items().find(item => item.name === itemName);
        name = itemName;
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    await bot.equip(item, 'hand');
    await bot.consume();
    log(bot, `Consumed ${item.name}.`);
    return true;
}


export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    if (bot.username === username) {
        log(bot, `You cannot give items to yourself.`);
        return false;
    }
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username, 3);
    // if we are 2 below the player
    log(bot, bot.entity.position.y, player.position.y);
    if (bot.entity.position.y < player.position.y - 1) {
        await goToPlayer(bot, username, 1);
    }
    // if we are too close, make some distance
    if (bot.entity.position.distanceTo(player.position) < 2) {
        let too_close = true;
        let start_moving_away = Date.now();
        await moveAwayFromEntity(bot, player, 2);
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            too_close = bot.entity.position.distanceTo(player.position) < 5;
            if (too_close) {
                await moveAwayFromEntity(bot, player, 5);
            }
            if (Date.now() - start_moving_away > 3000) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}, too close.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    if (await discard(bot, itemType, num)) {
        let given = false;
        bot.once('playerCollect', (collector, collected) => {
            console.log(collected.name);
            if (collector.username === username) {
                log(bot, `${username} received ${itemType}.`);
                given = true;
            }
        });
        let start = Date.now();
        while (!given && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (given) {
                return true;
            }
            if (Date.now() - start > 3000) {
                break;
            }
        }
    }
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}


// [mindaxis-patch:unified-door-exit] — 全ナビゲーション経路で使う統一ドア脱出関数
async function _exitHouseIfNeeded(bot) {
    if (bot._doorExitInProgress || bot._doorEntryInProgress) return true; // 再帰防止 + 入室中は脱出しない
    if (!bot._houseStructure) {
        try {
            const _fs = await import('fs');
            const _hp = './bots/' + bot.username + '/house.json';
            if (_fs.existsSync(_hp)) {
                const _hd = JSON.parse(_fs.readFileSync(_hp, 'utf8'));
                if (_hd && _hd.bounds) bot._houseStructure = _hd;
            }
        } catch(_) {}
    }
    const _hs = bot._houseStructure;
    if (!_hs || !_hs.bounds || !_hs.door) return true;
    const _pos = bot.entity.position;
    const _hb = _hs.bounds;
    const _inside = _pos.x > _hb.x1 && _pos.x < _hb.x2 && _pos.z > _hb.z1 && _pos.z < _hb.z2
                 && _pos.y >= _hb.y && _pos.y <= (_hb.roofY || _hb.y + 4);
    if (!_inside) return true;
    bot._doorExitInProgress = true;
    try {
        log(bot, 'Exiting house through door...');
        const _doorX = _hs.door.x, _doorZ = _hs.door.z;
        const _doorY = _hb.y + 1;
        const _facing = _hs.door.facing;
        const Vec3 = (await import('vec3')).default || (await import('vec3'));
        const _Vec3 = typeof Vec3 === 'function' ? Vec3 : Vec3.Vec3 || Vec3;
        let _innerX = _doorX, _innerZ = _doorZ;
        if (_facing === 'west') _innerX += 1.5;
        else if (_facing === 'east') _innerX -= 1.5;
        else if (_facing === 'north') _innerZ += 1.5;
        else if (_facing === 'south') _innerZ -= 1.5;
        const _moves = new pf.Movements(bot);
        _moves.allow1by1towers = false;
        _moves.canPlaceOn = false;
        bot.pathfinder.setMovements(_moves);
        try {
            await bot.pathfinder.goto(new pf.goals.GoalNear(_innerX, _doorY, _innerZ, 1));
        } catch(_e) {
            log(bot, 'Could not pathfind to door interior: ' + _e.message);
        }
        if (bot.interrupt_code) { bot._doorExitInProgress = false; return false; }
        const _doorBlock = bot.blockAt(new _Vec3(_doorX, _doorY, _doorZ));
        if (_doorBlock && _doorBlock.name.includes('door')) {
            const _props = _doorBlock.getProperties ? _doorBlock.getProperties() : {};
            if (_props.open === false || _props.open === 'false') {
                await bot.activateBlock(_doorBlock);
                await new Promise(r => setTimeout(r, 300));
            }
        }
        let _exitX = _doorX + 0.5, _exitZ = _doorZ + 0.5;
        if (_facing === 'west') _exitX -= 2;
        else if (_facing === 'east') _exitX += 2;
        else if (_facing === 'north') _exitZ -= 2;
        else if (_facing === 'south') _exitZ += 2;
        await bot.lookAt(new _Vec3(_exitX, _doorY, _exitZ));
        bot.setControlState('forward', true);
        for (let _wi = 0; _wi < 20; _wi++) {
            await new Promise(r => setTimeout(r, 200));
            if (bot.interrupt_code) break;
            const _cp = bot.entity.position;
            const _nowInside = _cp.x > _hb.x1 && _cp.x < _hb.x2 && _cp.z > _hb.z1 && _cp.z < _hb.z2;
            if (!_nowInside) break;
        }
        bot.setControlState('forward', false);
        const _fp = bot.entity.position;
        const _stillInside = _fp.x > _hb.x1 && _fp.x < _hb.x2 && _fp.z > _hb.z1 && _fp.z < _hb.z2;
        if (_stillInside) {
            log(bot, 'Door exit FAILED - still inside house at ' + _fp.floored());
            bot._doorExitInProgress = false;
            return false;
        }
        log(bot, 'Exited house through door at ' + _fp.floored());
        bot._doorExitInProgress = false;
        return true;
    } catch (e) {
        log(bot, 'Door exit error: ' + e.message);
        bot.setControlState('forward', false);
        bot._doorExitInProgress = false;
        return false;
    }
}

export async function goToGoal(bot, goal) {
    // [mindaxis-patch:goToGoal-door-exit]
    // 目標が家の中ならドア脱出しない（GoalInvert=移動離れ→常に脱出）
    {
        let _skipDoorExit = false;
        const _hs0 = bot._houseStructure;
        if (_hs0 && _hs0.bounds && goal && goal.x !== undefined && goal.z !== undefined && !goal.goal) {
            const _hb0 = _hs0.bounds;
            _skipDoorExit = goal.x > _hb0.x1 && goal.x < _hb0.x2 && goal.z > _hb0.z1 && goal.z < _hb0.z2;
        }
        if (!_skipDoorExit) {
            await _exitHouseIfNeeded(bot);
            if (bot.interrupt_code) return;
        }
    }
    /**
     * Navigate to the given goal. Use doors and attempt minimally destructive movements.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {pf.goals.Goal} goal, the goal to navigate to.
     **/

    const nonDestructiveMovements = new pf.Movements(bot);
    const dontBreakBlocks = ['glass', 'glass_pane'];
    for (let block of dontBreakBlocks) {
        nonDestructiveMovements.blocksCantBreak.add(mc.getBlockId(block));
    }
    nonDestructiveMovements.placeCost = 2;
    nonDestructiveMovements.digCost = 10;

    const destructiveMovements = new pf.Movements(bot);

    // [mindaxis-patch:house-wall-protect] 家の壁を pathfinder の破壊対象から保護
    // house.json から家の bounds を復元
    if (!bot._houseStructure) {
        try {
            const _fs = await import('fs');
            const _housePath = './bots/' + bot.username + '/house.json';
            if (_fs.existsSync(_housePath)) {
                const _hd = JSON.parse(_fs.readFileSync(_housePath, 'utf8'));
                if (_hd && _hd.bounds) {
                    bot._houseStructure = _hd;
                }
            }
        } catch(_e) {}
    }
    // 家具が未記録なら起動時に自動スキャン
    if (bot._houseStructure && bot._houseStructure.bounds && (!bot._houseStructure.furniture || bot._houseStructure.furniture.length === 0)) {
        try {
            const _hsb = bot._houseStructure.bounds;
            const _furniture = [];
            for (let _fx = _hsb.x1 + 1; _fx < _hsb.x2; _fx++) {
                for (let _fz = _hsb.z1 + 1; _fz < _hsb.z2; _fz++) {
                    for (let _fdy = 1; _fdy <= 3; _fdy++) {
                        const _fb = bot.blockAt(new Vec3(_fx, (_hsb.y || 69) + _fdy, _fz));
                        if (!_fb) continue;
                        if (_fb.name.includes('chest')) _furniture.push('chest@' + _fx + ',' + ((_hsb.y||69)+_fdy) + ',' + _fz);
                        if (_fb.name.includes('bed')) _furniture.push('bed@' + _fx + ',' + ((_hsb.y||69)+_fdy) + ',' + _fz);
                        if (_fb.name === 'furnace') _furniture.push('furnace@' + _fx + ',' + ((_hsb.y||69)+_fdy) + ',' + _fz);
                        if (_fb.name === 'crafting_table') _furniture.push('crafting_table@' + _fx + ',' + ((_hsb.y||69)+_fdy) + ',' + _fz);
                    }
                }
            }
            if (_furniture.length > 0) {
                bot._houseStructure.furniture = _furniture;
                console.log('[house] Auto-scanned furniture:', _furniture.join(', '));
                // house.json にも保存
                const _fs2 = await import('fs');
                const _hp2 = './bots/' + bot.username + '/house.json';
                const _hd2 = JSON.parse(_fs2.readFileSync(_hp2, 'utf8'));
                _hd2.furniture = _furniture;
                _fs2.writeFileSync(_hp2, JSON.stringify(_hd2, null, 2));
            }
        } catch(_fe) { console.log('[house] Furniture auto-scan failed:', _fe.message); }
    }
    if (bot._houseStructure && bot._houseStructure.bounds) {
        const _b = bot._houseStructure.bounds;
        const _d = bot._houseStructure.door;
        const _roofY = _b.roofY || (_b.y + 4);
        const _protect = (block) => {
            const p = block.position;
            if (!p) return 0;
            if (p.y <= _b.y || p.y > _roofY) return 0;
            if (_d && p.x === _d.x && p.z === _d.z && (p.y - _b.y) <= 2) return 0;
            const onNorthSouth = (p.z === _b.z1 || p.z === _b.z2) && p.x >= _b.x1 && p.x <= _b.x2;
            const onEastWest = (p.x === _b.x1 || p.x === _b.x2) && p.z >= _b.z1 && p.z <= _b.z2;
            const onRoof = p.y === _roofY && p.x >= _b.x1 && p.x <= _b.x2 && p.z >= _b.z1 && p.z <= _b.z2;
            return (onNorthSouth || onEastWest || onRoof) ? Infinity : 0;
        };
        nonDestructiveMovements.exclusionAreasBreak.push(_protect);
        destructiveMovements.exclusionAreasBreak.push(_protect);
        // monkey-patch: どの movements が使われても壁保護を自動適用
        if (!bot._wallProtectPatched) {
            bot._wallProtectFn = _protect;
            const _origSetMovements = bot.pathfinder.setMovements.bind(bot.pathfinder);
            bot.pathfinder.setMovements = function(moves) {
                if (moves && moves.exclusionAreasBreak && bot._wallProtectFn) {
                    if (!moves.exclusionAreasBreak.includes(bot._wallProtectFn)) {
                        moves.exclusionAreasBreak.push(bot._wallProtectFn);
                    }
                }
                // [water-surface-walkable] 水面を陸地と同じコストにする
                if (moves) moves.liquidCost = 0;
                return _origSetMovements(moves);
            };
            bot._wallProtectPatched = true;
        }
        // bot.dig() ラッパー: 全コードパスで家の壁/屋根/床の破壊を禁止
        if (!bot._digWrapped) {
            const _origDig = bot.dig.bind(bot);
            bot.dig = async function(_blk, ..._dArgs) {
                if (bot._allowHouseDig) return _origDig(_blk, ..._dArgs);
                const _hs = bot._houseStructure;
                if (_hs && _hs.bounds) {
                    const _hb = _hs.bounds, _p = _blk.position;
                    if (_p) {
                        const _ry = _hb.roofY || (_hb.y + 4);
                        const _fy = _hb.y || 69;
                        if (_p.y >= _fy && _p.y <= _ry && _p.x >= _hb.x1 && _p.x <= _hb.x2 && _p.z >= _hb.z1 && _p.z <= _hb.z2) {
                            const _isWall = _p.x === _hb.x1 || _p.x === _hb.x2 || _p.z === _hb.z1 || _p.z === _hb.z2;
                            const _isRoofOrFloor = _p.y === _ry || _p.y === _fy;
                            // ドア位置も壁として保護（pathfinder の canOpenDoors で開く）
                            if (_isWall || _isRoofOrFloor) return;
                        }
                    }
                }
                return _origDig(_blk, ..._dArgs);
            };
            bot._digWrapped = true;
        }
        // [#18/#23 fix] bot.pathfinder.goto ラッパー: 全コードパスで interrupt_code に応答
        if (!bot._gotoWrapped) {
            const _origGoto = bot.pathfinder.goto.bind(bot.pathfinder);
            bot.pathfinder.goto = function(_goal, _dynamic) {
                const _intCheck = setInterval(() => {
                    if (bot.interrupt_code) {
                        clearInterval(_intCheck);
                        try { bot.pathfinder.stop(); } catch(_) {}
                    }
                }, 500);
                return _origGoto(_goal, _dynamic).finally(() => {
                    clearInterval(_intCheck);
                });
            };
            bot._gotoWrapped = true;
        }
        // [no-place-in-house] bot.placeBlock ラッパー: 家内部+ドア前の建材配置を完全禁止
        // pathfinder の allow1by1towers / canPlaceOn が使う bot.placeBlock を直接ラップ
        // skills.placeBlock() も内部で bot.placeBlock() を呼ぶため、全経路をカバー
        if (!bot._placeBlockWrapped) {
            const _origPlaceBlock = bot.placeBlock.bind(bot);
            const _buildSet = new Set(['cobblestone','stone','dirt','oak_planks','oak_log','birch_planks','birch_log',
                'spruce_planks','spruce_log','jungle_planks','jungle_log','acacia_planks','acacia_log',
                'dark_oak_planks','dark_oak_log','oak_stairs','cobblestone_stairs','stone_bricks',
                'bricks','sandstone','sand','gravel','glass','oak_slab','cobblestone_slab',
                'cobbled_deepslate','deepslate_bricks','mossy_cobblestone','andesite','diorite','granite']);
            bot.placeBlock = async function(_refBlock, _faceVec, ..._pArgs) {
                const _hs = bot._houseStructure;
                if (_hs && _hs.bounds && _refBlock && _faceVec) {
                    const _hb = _hs.bounds;
                    const _ry = _hb.roofY || (_hb.y + 4);
                    const _pp = _refBlock.position.offset(_faceVec.x, _faceVec.y, _faceVec.z);
                    const _px = Math.floor(_pp.x), _py = Math.floor(_pp.y), _pz = Math.floor(_pp.z);
                    // 家内部チェック
                    const _inside = _px >= _hb.x1 && _px <= _hb.x2 && _pz >= _hb.z1 && _pz <= _hb.z2
                        && _py >= _hb.y && _py <= _ry;
                    // ドア前チェック（ドアの外側1ブロック）
                    const _d = _hs.door;
                    const _nearDoor = _d && Math.abs(_px - _d.x) <= 1 && Math.abs(_pz - _d.z) <= 1
                        && _py >= _hb.y && _py <= _ry;
                    if ((_inside || _nearDoor) && !bot._repairMode) {
                        const _held = bot.heldItem;
                        if (_held && _buildSet.has(_held.name)) {
                            return; // 建材ブロック配置を拒否
                        }
                    }
                }
                return _origPlaceBlock(_refBlock, _faceVec, ..._pArgs);
            };
            bot._placeBlockWrapped = true;
        }
    }

    let final_movements = destructiveMovements;

    const pathfind_timeout = 1000;
    if (await bot.pathfinder.getPathTo(nonDestructiveMovements, goal, pathfind_timeout).status === 'success') {
        final_movements = nonDestructiveMovements;
        log(bot, `Found non-destructive path.`);
    }
    else if (await bot.pathfinder.getPathTo(destructiveMovements, goal, pathfind_timeout).status === 'success') {
        log(bot, `Found destructive path.`);
    }
    else {
        log(bot, `Path not found, but attempting to navigate anyway using destructive movements.`);
    }

    const doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setMovements(final_movements);
    try {
        await bot.pathfinder.goto(goal);
        clearInterval(doorCheckInterval);
        return true;
    } catch (err) {
        clearInterval(doorCheckInterval);
        // we need to catch so we can clean up the door check interval, then rethrow the error
        throw err;
    }
}

let _doorInterval = null;
function startDoorInterval(bot) {
    /**
     * Start helper interval that opens nearby doors if the bot is stuck.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {number} the interval id.
     **/
    if (_doorInterval) {
        clearInterval(_doorInterval);
    }
    let prev_pos = bot.entity.position.clone();
    let prev_check = Date.now();
    let stuck_time = 0;


    const doorCheckInterval = setInterval(() => {
        const now = Date.now();
        if (bot.entity.position.distanceTo(prev_pos) >= 0.1) {
            stuck_time = 0;
        } else {
            stuck_time += now - prev_check;
        }
        
        if (stuck_time > 1200) {
            // shuffle positions so we're not always opening the same door
            const positions = [
                bot.entity.position.clone(),
                bot.entity.position.offset(0, 0, 1),
                bot.entity.position.offset(0, 0, -1), 
                bot.entity.position.offset(1, 0, 0),
                bot.entity.position.offset(-1, 0, 0),
            ]
            let elevated_positions = positions.map(position => position.offset(0, 1, 0));
            positions.push(...elevated_positions);
            positions.push(bot.entity.position.offset(0, 2, 0)); // above head
            positions.push(bot.entity.position.offset(0, -1, 0)); // below feet
            
            let currentIndex = positions.length;
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;
                [positions[currentIndex], positions[randomIndex]] = [
                positions[randomIndex], positions[currentIndex]];
            }
            
            for (let position of positions) {
                let block = bot.blockAt(position);
                if (block && block.name &&
                    !block.name.includes('iron') &&
                    (block.name.includes('door') ||
                     block.name.includes('fence_gate') ||
                     block.name.includes('trapdoor'))) 
                {
                    bot.activateBlock(block);
                    break;
                }
            }
            stuck_time = 0;
        }
        prev_pos = bot.entity.position.clone();
        prev_check = now;
    }, 200);
    _doorInterval = doorCheckInterval;
    return doorCheckInterval;
}

// [mindaxis-patch:location-discovery] 移動中に周囲の特徴的な場所を自動発見・記録
async function _discoverLocations(bot) {
    try {
        const _fs = await import('fs');
        const _memPath = './bots/' + bot.username + '/location_memory.json';
        let _lm = {};
        try { _lm = JSON.parse(_fs.readFileSync(_memPath, 'utf8')); } catch(_) {}
        if (!_lm.places) _lm.places = {};
        const _pos = bot.entity.position;
        let _changed = false;
        // 村の検出（村人がいれば村）
        const _villagers = Object.values(bot.entities).filter(e => e.name === 'villager' && e.position.distanceTo(_pos) < 48);
        if (_villagers.length >= 2) {
            if (!_lm.places.village) _lm.places.village = [];
            const _vx = Math.round(_villagers.reduce((s,v)=>s+v.position.x,0)/_villagers.length);
            const _vz = Math.round(_villagers.reduce((s,v)=>s+v.position.z,0)/_villagers.length);
            if (!_lm.places.village.some(v => Math.abs(v.x-_vx)<60 && Math.abs(v.z-_vz)<60)) {
                _lm.places.village.push({x:_vx, z:_vz, y:Math.round(_pos.y), villagers:_villagers.length, discoveredAt:Date.now()});
                log(bot, `Discovered village at (${_vx}, ${_vz}) with ${_villagers.length} villagers!`);
                _changed = true;
            }
        }
        // 危険地帯の検出（溶岩源が近くに3つ以上、地表レベルのみ）
        // [mindaxis-patch:lava-surface-only] 地下溶岩洞窟を除外（ボット足元±3ブロック以内のみ）
        const _lavaBlocks = world.getNearestBlocks(bot, 'lava', 16, 5).filter(b => Math.abs(b.position.y - _pos.y) <= 3);
        if (_lavaBlocks.length >= 3) {
            if (!_lm.places.danger) _lm.places.danger = [];
            const _lx = Math.round(_pos.x), _lz = Math.round(_pos.z);
            if (!_lm.places.danger.some(d => Math.abs(d.x-_lx)<30 && Math.abs(d.z-_lz)<30)) {
                _lm.places.danger.push({x:_lx, z:_lz, y:Math.round(_pos.y), type:'lava', discoveredAt:Date.now()});
                log(bot, `Danger zone: lava at (${_lx}, ${_lz}). Will avoid this area.`);
                _changed = true;
            }
        }
        if (_changed) _fs.writeFileSync(_memPath, JSON.stringify(_lm, null, 2), 'utf8');
    } catch(_) {}
}



// [mindaxis-patch:manual-nav] 手動ナビゲーション：pathfinder が詰まった時のフォールバック
// 地形を読んで jump + forward で目標方向に移動する
// 優先順位: 階段地形を利用 → ピラージャンプで強引に移動 → 救出モード
async function manualWalkToward(bot, targetX, targetZ, maxSeconds) {
    const startPos = bot.entity.position.clone();
    const startTime = Date.now();
    const timeoutMs = maxSeconds * 1000;

    function isPassable(name) {
        return !name || name === 'air' || name === 'cave_air' || name === 'water'
            || name === 'flowing_water' || name === 'short_grass' || name === 'tall_grass'
            || name === 'snow_layer' || name.includes('flower') || name === 'poppy' || name === 'dandelion'
            || name === 'seagrass' || name === 'tall_seagrass' || name === 'kelp' || name === 'kelp_plant';
    }

    function isSolid(name) {
        return name && !isPassable(name) && name !== 'lava' && name !== 'flowing_lava';
    }

    // 8方向×最大5ブロック先まで地形をトレースして歩ける経路を見つける
    function findBestDirection(cp, cy) {
        const dx = targetX - cp.x;
        const dz = targetZ - cp.z;
        const targetAngle = Math.atan2(dz, dx);
        const SCAN_DIST = 5;

        const dirs = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI / 4);
            const ax = Math.cos(angle);
            const az = Math.sin(angle);

            let curY = cy;
            let walkableSteps = 0;
            let totalClimb = 0;
            let firstStepUp = false;

            for (let dist = 1; dist <= SCAN_DIST; dist++) {
                const nx = Math.floor(cp.x + ax * dist);
                const nz = Math.floor(cp.z + az * dist);

                const body = bot.blockAt(new Vec3(nx, curY + 1, nz));
                const head = bot.blockAt(new Vec3(nx, curY + 2, nz));

                if (isPassable(body?.name) && isPassable(head?.name)) {
                    let groundY = curY;
                    for (let dy = 0; dy >= -3; dy--) {
                        const below = bot.blockAt(new Vec3(nx, curY + dy, nz));
                        if (below && isSolid(below.name)) { groundY = curY + dy; break; }
                    }
                    curY = groundY + 1;
                    walkableSteps++;
                    continue;
                }

                const stepBody = bot.blockAt(new Vec3(nx, curY + 2, nz));
                const stepHead = bot.blockAt(new Vec3(nx, curY + 3, nz));
                const stepGround = bot.blockAt(new Vec3(nx, curY + 1, nz));

                if (isSolid(stepGround?.name) && isPassable(stepBody?.name) && isPassable(stepHead?.name)) {
                    curY = curY + 1;
                    walkableSteps++;
                    totalClimb++;
                    if (dist === 1) firstStepUp = true;
                    continue;
                }
                break;
            }

            if (walkableSteps >= 1) {
                let angleDiff = Math.abs(angle - targetAngle);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                const score = walkableSteps * 2 + totalClimb * 3 - angleDiff * 2;
                dirs.push({ angle, ax, az, angleDiff, stepUp: firstStepUp, walkableSteps, totalClimb, score });
            }
        }
        dirs.sort((a, b) => b.score - a.score);
        return dirs.length > 0 ? dirs[0] : null;
    }

    let lastY = Math.floor(startPos.y);
    let stuckSteps = 0;

    for (let step = 0; step < maxSeconds * 4; step++) {
        if (Date.now() - startTime > timeoutMs) break;
        if (bot.interrupt_code) break;

        const cp = bot.entity.position;
        const dx = targetX - cp.x;
        const dz = targetZ - cp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 3) { log(bot, '[manual-nav] Close enough to waypoint.'); break; }

        const cx = Math.floor(cp.x), cy = Math.floor(cp.y), cz = Math.floor(cp.z);

        const feetBlock = bot.blockAt(new Vec3(cx, cy, cz));
        const _isWaterLike = (n) => n === 'water' || n === 'flowing_water' || n === 'bubble_column';
        const inWater = feetBlock && _isWaterLike(feetBlock.name);

        if (inWater) {
            // [mindaxis-patch:shore-detect] 水中で岸（水→陸の遷移）を検出
            // クールダウン: 同じ場所で30秒以内は再発動しない
            const _sdNow = Date.now();
            if (bot._lastShoreDetectTime && _sdNow - bot._lastShoreDetectTime < 30000) {
                // クールダウン中 → shore-detect スキップ、pathfinder に任せる
            } else {
            bot._lastShoreDetectTime = _sdNow;
            // 失敗した岸の方向を記憶してブラックリスト
            if (!bot._shoreBlacklist) bot._shoreBlacklist = {};
            // 30秒経過したブラックリストを解除
            const now = Date.now();
            for (const k of Object.keys(bot._shoreBlacklist)) {
                if (now - bot._shoreBlacklist[k] > 120000) delete bot._shoreBlacklist[k];
            }

            // 経路上の bubble_column チェック関数
            function hasBubbleInPath(fromX, fromZ, toX, toZ, checkY) {
                const steps = Math.max(Math.abs(toX - fromX), Math.abs(toZ - fromZ));
                if (steps === 0) return false;
                for (let i = 1; i < steps; i++) {
                    const px = Math.floor(fromX + (toX - fromX) * i / steps);
                    const pz = Math.floor(fromZ + (toZ - fromZ) * i / steps);
                    for (let py = checkY - 1; py <= checkY + 1; py++) {
                        const b = bot.blockAt(new Vec3(px, py, pz));
                        if (b && (b.name === 'bubble_column' || b.name === 'magma_block')) return true;
                    }
                }
                return false;
            }

            let shoreX = null, shoreZ = null, shoreY = null;
            let shoreDist = 999;
            // 全候補を集めて最適を選択（bubble_column 回避）
            let shoreCandidates = [];
            for (let sr = 1; sr <= 12; sr++) {
                for (let sdx = -sr; sdx <= sr; sdx++) {
                    for (let sdz = -sr; sdz <= sr; sdz++) {
                        if (Math.abs(sdx) !== sr && Math.abs(sdz) !== sr) continue;
                        const sx = cx + sdx, sz = cz + sdz;
                        for (let sy = cy - 2; sy <= cy + 3; sy++) {
                            const ground = bot.blockAt(new Vec3(sx, sy, sz));
                            if (!ground || !isSolid(ground.name)) continue;
                            const above1 = bot.blockAt(new Vec3(sx, sy + 1, sz));
                            const above2 = bot.blockAt(new Vec3(sx, sy + 2, sz));
                            if (!isPassable(above1?.name) || !isPassable(above2?.name)) continue;
                            // 水中の地面は「岸」ではない — 足元が水なら無視
                            if (above1?.name === 'water' || above1?.name === 'flowing_water') continue;
                            if (above1?.name === 'bubble_column') continue;
                            // [mindaxis-patch:shore-seagrass] seagrass/tall_seagrass は水中海底 → 岸ではない
                            if (above1?.name === 'seagrass' || above1?.name === 'tall_seagrass') continue;
                            let adjacentWater = false;
                            for (let adj of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
                                const nb = bot.blockAt(new Vec3(sx + adj.x, sy, sz + adj.z));
                                const nb2 = bot.blockAt(new Vec3(sx + adj.x, sy + 1, sz + adj.z));
                                if ((nb && (nb.name === 'water' || nb.name === 'flowing_water'))
                                 || (nb2 && (nb2.name === 'water' || nb2.name === 'flowing_water'))) {
                                    adjacentWater = true; break;
                                }
                            }
                            if (!adjacentWater) continue;
                            // [mindaxis-patch:shore-min-y] 地下洞窟（y<60）の壁を岸として誤認識しないようフィルタ
                            if (sy < 60) continue;
                            const d = Math.sqrt(sdx * sdx + sdz * sdz);
                            const key = sx + ',' + sz;
                            const blacklisted = !!bot._shoreBlacklist[key];
                            const hasBubble = hasBubbleInPath(cx, cz, sx, sz, cy);
                            // 優先順位: bubble無し+BL無し > bubble無し+BL有り > bubble有り
                            const penalty = (hasBubble ? 100 : 0) + (blacklisted ? 50 : 0);
                            shoreCandidates.push({ sx, sy, sz, d, penalty, key, groundName: ground.name });
                        }
                    }
                }
            }
            // ペナルティ→距離でソート
            shoreCandidates.sort((a, b) => (a.penalty + a.d) - (b.penalty + b.d));
            if (shoreCandidates.length > 0) {
                const best = shoreCandidates[0];
                shoreX = best.sx + 0.5; shoreZ = best.sz + 0.5; shoreY = best.sy + 1;
                shoreDist = best.d;
                if (shoreCandidates.length <= 3 || best.penalty === 0) {
                    console.log('[shore-detect] Found shore at', best.sx, best.sy, best.sz, best.groundName, 'dist=', Math.round(best.d), best.penalty > 0 ? '(penalty=' + best.penalty + ')' : '');
                }
            }

            if (shoreX && shoreDist <= 8) {
                // pathfinder を止めてから手動スプリント（pathfinder と引っ張り合い防止）
                try { bot.pathfinder.stop(); } catch(_) {}
                await bot.lookAt(new Vec3(shoreX, shoreY, shoreZ));
                bot.setControlState('forward', true);
                bot.setControlState('jump', true);
                bot.setControlState('sprint', true);
                let landedOnShore = false;
                for (let sw = 0; sw < 60; sw++) {
                    if (bot.interrupt_code) break;
                    await new Promise(r => setTimeout(r, 100));
                    const nowPos = bot.entity.position;
                    const nowFx = Math.floor(nowPos.x), nowFy = Math.floor(nowPos.y), nowFz = Math.floor(nowPos.z);
                    const nowBelow = bot.blockAt(new Vec3(nowFx, nowFy - 1, nowFz));
                    const nowFeet = bot.blockAt(new Vec3(nowFx, nowFy, nowFz));
                    const feetWater = nowFeet && _isWaterLike(nowFeet.name);
                    if (!feetWater && nowBelow && isSolid(nowBelow.name) && nowBelow.name !== 'magma_block') {
                        console.log('[shore-detect] Landed on', nowBelow.name, 'at', nowFx, nowFy, nowFz);
                        landedOnShore = true; break;
                    }
                    // 毎tick lookAt を更新（方向ずれ防止）
                    await bot.lookAt(new Vec3(shoreX, shoreY, shoreZ));
                }
                bot.setControlState('forward', false);
                bot.setControlState('jump', false);
                bot.setControlState('sprint', false);
                if (landedOnShore) {
                    // [mindaxis-patch:shore-detect-surface] 陸に上がったら即goToSurfaceで地上へ（水際に戻るループ防止）
                    log(bot, '[shore-detect] Reached shore, calling goToSurface before pathfinder.');
                    bot._shoreBlacklist = {}; // 成功したらブラックリストクリア
                    await goToSurface(bot);
                    break;
                }
                // 失敗: この岸をブラックリストに追加
                const failKey = Math.floor(shoreX) + ',' + Math.floor(shoreZ);
                bot._shoreBlacklist[failKey] = Date.now();
                console.log('[shore-detect] Failed to reach shore, blacklisting', failKey);

                // 全候補がブラックリスト済みなら、足元にブロックを置いて脱出
                if (!bot._shoreEscapeAttempts) bot._shoreEscapeAttempts = 0;
                bot._shoreEscapeAttempts++;
                if (bot._shoreEscapeAttempts >= 4) {
                    console.log('[shore-detect] All shores failed, attempting block placement escape');
                    const escapeBlocks = ['cobblestone', 'dirt', 'stone', 'sand', 'netherrack', 'oak_planks', 'cobbled_deepslate'];
                    let placed = false;
                    for (const bName of escapeBlocks) {
                        const item = bot.inventory.items().find(i => i.name === bName);
                        if (item) {
                            try {
                                await bot.equip(item, 'hand');
                                bot.setControlState('jump', true);
                                await new Promise(r => setTimeout(r, 400));
                                const belowPos = bot.entity.position.offset(0, -1, 0).floored();
                                const refBlock = bot.blockAt(belowPos.offset(0, -1, 0));
                                if (refBlock) {
                                    await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
                                    console.log('[shore-detect] Placed', bName, 'to escape water');
                                    placed = true;
                                }
                                bot.setControlState('jump', false);
                            } catch (e) { bot.setControlState('jump', false); }
                            if (placed) break;
                        }
                    }
                    bot._shoreEscapeAttempts = 0;
                    if (placed) continue;
                }

                await new Promise(r => setTimeout(r, 100));
                continue;
            } // end else (cooldown)
            } // end if (inWater)
            await bot.lookAt(new Vec3(targetX, cp.y + 1.5, targetZ));
            bot.setControlState('forward', true);
            bot.setControlState('jump', true);
            bot.setControlState('sprint', true);
            await new Promise(r => setTimeout(r, 300));
            if (bot.interrupt_code) { bot.setControlState('forward', false); bot.setControlState('jump', false); bot.setControlState('sprint', false); break; }
            await new Promise(r => setTimeout(r, 300));
            bot.setControlState('forward', false);
            bot.setControlState('jump', false);
            bot.setControlState('sprint', false);
            await new Promise(r => setTimeout(r, 100));
            continue;
        }

        const best = findBestDirection(cp, cy);
        if (best) {
            const lookX = cp.x + best.ax * 5;
            const lookZ = cp.z + best.az * 5;
            await bot.lookAt(new Vec3(lookX, cp.y + (best.stepUp ? 1.5 : 1), lookZ));
            bot.setControlState('forward', true);
            if (best.stepUp) {
                bot.setControlState('jump', true);
                bot.setControlState('sprint', true);
                await new Promise(r => setTimeout(r, 350));
                bot.setControlState('jump', false);
                bot.setControlState('sprint', false);
            } else {
                bot.setControlState('jump', true);
                await new Promise(r => setTimeout(r, 250));
                bot.setControlState('jump', false);
            }
            bot.setControlState('forward', false);
            await new Promise(r => setTimeout(r, 50));
        } else {
            log(bot, '[manual-nav] No walkable path, pillar jumping...');
            const pillarItem = bot.inventory.items().find(i => i.name === 'dirt')
                || bot.inventory.items().find(i => i.name === 'cobblestone')
                || bot.inventory.items().find(i => i.name.includes('planks'))
                || bot.inventory.items().find(i => i.name.includes('stone') || i.name.includes('deepslate'));
            if (pillarItem) {
                await bot.equip(pillarItem, 'hand');
                let standBlock = null;
                for (let dy = 0; dy <= 3; dy++) {
                    let b = bot.blockAt(new Vec3(cx, cy - dy, cz));
                    if (b && isSolid(b.name)) { standBlock = b; break; }
                }
                if (standBlock) {
                    await bot.lookAt(new Vec3(cp.x, cp.y - 2, cp.z));
                    bot.setControlState('jump', true);
                    await new Promise(r => setTimeout(r, 300));
                    try {
                        await bot.placeBlock(standBlock, new Vec3(0, 1, 0));
                    } catch(e) {
                        for (let dir of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
                            let sideB = bot.blockAt(new Vec3(cx + dir.x, cy, cz + dir.z));
                            if (sideB && isSolid(sideB.name)) {
                                try { await bot.placeBlock(sideB, new Vec3(-dir.x, 0, -dir.z)); break; } catch(e2) {}
                            }
                        }
                    }
                    bot.setControlState('jump', false);
                    await new Promise(r => setTimeout(r, 500));
                }
            } else {
                await bot.lookAt(new Vec3(targetX, cp.y + 1, targetZ));
                bot.setControlState('forward', true);
                bot.setControlState('jump', true);
                await new Promise(r => setTimeout(r, 500));
                bot.setControlState('forward', false);
                bot.setControlState('jump', false);
                await new Promise(r => setTimeout(r, 200));
            }
        }

        const newY = Math.floor(bot.entity.position.y);
        if (newY === lastY) { stuckSteps++; } else { stuckSteps = 0; lastY = newY; }
        if (stuckSteps > 12) { log(bot, '[manual-nav] Stuck for too long, giving up.'); break; }
    }

    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    bot.setControlState('sprint', false);

    const moved = bot.entity.position.distanceTo(startPos);
    log(bot, '[manual-nav] Moved ' + Math.round(moved) + ' blocks manually.');
    return moved > 2;
}

export async function goToPosition(bot, x, y, z, min_distance=2) {
    // [mindaxis-patch:location-discover-call] 移動開始時に周囲の場所を自動発見
    await _discoverLocations(bot);
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    if (x == null || y == null || z == null) {
        log(bot, `Missing coordinates, given x:${x} y:${y} z:${z}`);
        return false;
    }
    // [mindaxis-patch:death-zone-nav-warn] 死亡地点への接近を警告
    {
        const _dz = (bot._deathZones || []).find(z => Math.sqrt((x-z.x)**2+(y-z.y)**2+(z-z.z)**2) < 15);
        if (_dz) log(bot, `CAUTION: Navigating near previous death location (${_dz.x},${_dz.y},${_dz.z}) — cause: ${_dz.cause}×${_dz.count}. ${_dz.cause==='drown'?'Underwater hazard — abort immediately if submerged.':'Proceed carefully.'}`);
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        log(bot, `Teleported to ${x}, ${y}, ${z}.`);
        return true;
    }
    
    // [mindaxis-patch:goto-comprehensive] door-exit + precheck-surface + progress-timeout + nav upgrade

    console.log('[goto-trace] goToPosition START target=(' + x + ',' + y + ',' + z + ') pos=(' + Math.round(bot.entity.position.x) + ',' + Math.round(bot.entity.position.y) + ',' + Math.round(bot.entity.position.z) + ')');
    // house.json から _houseStructure を早期ロード（door-entry/exit で必要）
    if (!bot._houseStructure) {
        try {
            const _fs2 = await import('fs');
            const _hp = './bots/' + bot.username + '/house.json';
            if (_fs2.existsSync(_hp)) {
                const _hd2 = JSON.parse(_fs2.readFileSync(_hp, 'utf8'));
                if (_hd2 && _hd2.bounds) bot._houseStructure = _hd2;
            }
        } catch(_e2) {}
    }
    console.log('[goto-trace] house loaded=' + !!bot._houseStructure);

    // door-exit-route: _exitHouseIfNeeded で統一処理 /* [mindaxis-patch:goto-door-exit-unified] */
    {
        const _hs = bot._houseStructure;
        if (_hs && _hs.bounds && _hs.door) {
            const _pos = bot.entity.position;
            const _hb = _hs.bounds;
            const _inside = _pos.x > _hb.x1 && _pos.x < _hb.x2 && _pos.z > _hb.z1 && _pos.z < _hb.z2
                         && _pos.y >= _hb.y && _pos.y <= (_hb.roofY || _hb.y + 4);
            const _targetInside = x > _hb.x1 && x < _hb.x2 && z > _hb.z1 && z < _hb.z2;
            if (_inside && !_targetInside) {
                bot._doorExitInProgress = true;
                try {
                    log(bot, 'Exiting house through door (manual)...');
                    const _doorX = _hs.door.x, _doorZ = _hs.door.z;
                    const _doorY = _hb.y + 1;
                    const _facing = _hs.door.facing;
                    // ドアブロックを取得して開ける
                    const Vec3 = (await import('vec3')).default || (await import('vec3'));
                    const _Vec3 = typeof Vec3 === 'function' ? Vec3 : Vec3.Vec3 || Vec3;
                    const _doorBlock = bot.blockAt(new _Vec3(_doorX, _doorY, _doorZ));
                    if (_doorBlock && _doorBlock.name.includes('door')) {
                        const _props = _doorBlock.getProperties ? _doorBlock.getProperties() : {};
                        if (_props.open === false || _props.open === 'false') {
                            await bot.activateBlock(_doorBlock);
                            await new Promise(r => setTimeout(r, 300));
                        }
                    }
                    // ドアの外側の座標を計算（2ブロック先）
                    let _exitX = _doorX + 0.5, _exitZ = _doorZ + 0.5;
                    if (_facing === 'west') _exitX -= 2;
                    else if (_facing === 'east') _exitX += 2;
                    else if (_facing === 'north') _exitZ -= 2;
                    else if (_facing === 'south') _exitZ += 2;
                    // ドア方向を向いて歩く
                    await bot.lookAt(new _Vec3(_exitX, _doorY, _exitZ));
                    bot.setControlState('forward', true);
                    // 最大3秒歩く（家の外に出たら停止）
                    for (let _wi = 0; _wi < 15; _wi++) {
                        await new Promise(r => setTimeout(r, 200));
                        if (bot.interrupt_code) break;
                        const _cp = bot.entity.position;
                        const _nowInside = _cp.x > _hb.x1 && _cp.x < _hb.x2 && _cp.z > _hb.z1 && _cp.z < _hb.z2;
                        if (!_nowInside) break;
                    }
                    bot.setControlState('forward', false);
                    log(bot, 'Exited house through door.');
                } catch (e) {
                    log(bot, 'Door exit failed: ' + e.message);
                    bot.setControlState('forward', false);
                }
                bot._doorExitInProgress = false;
            }
        }
    }

    console.log('[goto-trace] door-exit done');
    // door-entry-route: 外から家の中へドアを手動で開けて入る（pathfinder 不使用）
    {
        const _hs2 = bot._houseStructure;
        if (_hs2 && _hs2.bounds && _hs2.door && !bot._doorEntryInProgress) {
            const _pos2 = bot.entity.position;
            const _hb2 = _hs2.bounds;
            const _inside2 = _pos2.x > _hb2.x1 && _pos2.x < _hb2.x2 && _pos2.z > _hb2.z1 && _pos2.z < _hb2.z2
                           && _pos2.y >= _hb2.y && _pos2.y <= (_hb2.roofY || _hb2.y + 4);
            const _targetInside2 = x > _hb2.x1 && x < _hb2.x2 && z > _hb2.z1 && z < _hb2.z2
                                 && y >= _hb2.y && y <= (_hb2.roofY || _hb2.y + 4);
            // ボットが外にいて目標が家の中の場合 → 距離に関わらずドア経由 [mindaxis-patch:door-entry-no-dist-limit]
            const _distToHouse = Math.sqrt((_pos2.x - (_hb2.x1 + _hb2.x2) / 2) ** 2 + (_pos2.z - (_hb2.z1 + _hb2.z2) / 2) ** 2);
            console.log('[goto-trace] door-entry check: inside=' + _inside2 + ' targetInside=' + _targetInside2 + ' distToHouse=' + Math.round(_distToHouse));
            if (!_inside2 && _targetInside2) {
                    bot._doorEntryInProgress = true;
                    try {
                        log(bot, 'Target is inside house. Navigating to door first...');
                        const _doorX2 = _hs2.door.x, _doorZ2 = _hs2.door.z;
                        const _doorY2 = _hb2.y + 1;
                        const _facing2 = _hs2.door.facing;
                        const Vec3e = (await import('vec3')).default || (await import('vec3'));
                        const _Vec3e = typeof Vec3e === 'function' ? Vec3e : Vec3e.Vec3 || Vec3e;
                        // ドアの外側座標を計算（地上レベル）
                        let _outsideX = _doorX2, _outsideZ = _doorZ2;
                        if (_facing2 === 'west') _outsideX -= 1;
                        else if (_facing2 === 'east') _outsideX += 1;
                        else if (_facing2 === 'north') _outsideZ -= 1;
                        else if (_facing2 === 'south') _outsideZ += 1;
                        // ドアの外側に pathfinder で移動（家の外なので地下に行かない）
                        await goToPosition(bot, _outsideX, _doorY2, _outsideZ, 1);
                        if (bot.interrupt_code) { bot._doorEntryInProgress = false; return false; }
                        log(bot, 'Reached door exterior. Walking through...');
                        // ドアを開ける
                        const _doorBlock2 = bot.blockAt(new _Vec3e(_doorX2, _doorY2, _doorZ2));
                        if (_doorBlock2 && _doorBlock2.name.includes('door')) {
                            const _props2 = _doorBlock2.getProperties ? _doorBlock2.getProperties() : {};
                            if (_props2.open === false || _props2.open === 'false') {
                                await bot.activateBlock(_doorBlock2);
                                await new Promise(r => setTimeout(r, 300));
                            }
                        }
                        // 家の中へ歩く
                        let _insideX = _doorX2 + 0.5, _insideZ = _doorZ2 + 0.5;
                        if (_facing2 === 'west') _insideX += 2;
                        else if (_facing2 === 'east') _insideX -= 2;
                        else if (_facing2 === 'north') _insideZ += 2;
                        else if (_facing2 === 'south') _insideZ -= 2;
                        await bot.lookAt(new _Vec3e(_insideX, _doorY2, _insideZ));
                        bot.setControlState('forward', true);
                        for (let _ei = 0; _ei < 15; _ei++) {
                            await new Promise(r => setTimeout(r, 200));
                            if (bot.interrupt_code) break;
                            const _cp2 = bot.entity.position;
                            const _nowIn = _cp2.x > _hb2.x1 && _cp2.x < _hb2.x2 && _cp2.z > _hb2.z1 && _cp2.z < _hb2.z2;
                            if (_nowIn) break;
                        }
                        bot.setControlState('forward', false);
                        log(bot, 'Entered house through door.');
                    } catch (e) {
                        log(bot, 'Door entry failed: ' + e.message);
                        bot.setControlState('forward', false);
                    }
                    bot._doorEntryInProgress = false;
            }
        }
    }

    console.log('[goto-trace] door-entry done');
    // precheck-surface: 地下にいて目標が上方なら先に地上へ出る
    {
        const curPos = bot.entity.position;
        const yDiff = y - curPos.y;
        let headBlock = bot.blockAt(new Vec3(Math.floor(curPos.x), Math.floor(curPos.y) + 2, Math.floor(curPos.z)));
        // 家の中・近くにいる場合は「地下」判定を無効化（ドアを使うべき）
        let _nearHouse = false;
        if (bot._houseStructure && bot._houseStructure.bounds) {
            const _nhb = bot._houseStructure.bounds;
            const _cx = Math.floor(curPos.x), _cz = Math.floor(curPos.z);
            _nearHouse = _cx >= _nhb.x1 - 2 && _cx <= _nhb.x2 + 2 && _cz >= _nhb.z1 - 2 && _cz <= _nhb.z2 + 2
                       && curPos.y >= _nhb.y - 2;
        }
        // [mindaxis-patch:underwater-is-underground] 水中は pathfinder に任せる（goToSurface を先に呼ばない）
        const isUnderground = !_nearHouse && headBlock && headBlock.name !== 'air' && headBlock.name !== 'cave_air' && headBlock.name !== 'water' && headBlock.name !== 'flowing_water' && headBlock.name !== 'lava';
        // [mindaxis-patch:deep-cave-surface] 大きな洞窟内でも目標より10ブロック以上低いなら地上優先
        const _deepBelowTarget = !_nearHouse && yDiff > 10;
        // [#22 fix] 家の直下にいる場合は横に移動してから地上へ（屋根/床破壊防止）
        let _underHouse = false;
        if (bot._houseStructure && bot._houseStructure.bounds) {
            const _uhb = bot._houseStructure.bounds;
            const _cx = Math.floor(curPos.x), _cz = Math.floor(curPos.z);
            _underHouse = _cx >= _uhb.x1 && _cx <= _uhb.x2 && _cz >= _uhb.z1 && _cz <= _uhb.z2
                       && curPos.y >= (_uhb.y - 5) && curPos.y < _uhb.y;
        }
        if ((isUnderground || _deepBelowTarget) && yDiff > 2 && !bot._pillarPreUsed) {
            bot._pillarPreUsed = true;
            try {
                if (_underHouse) {
                    // 家の直下: まず横に移動して家の外に出る
                    log(bot, 'Under house detected. Moving out horizontally before surface...');
                    const _uhb = bot._houseStructure.bounds;
                    // 家の端から最も近い方向に5ブロック外へ
                    const _cx = curPos.x, _cz = curPos.z;
                    const _dists = [
                        { dir: 'west',  x: _uhb.x1 - 3, z: _cz, d: _cx - _uhb.x1 },
                        { dir: 'east',  x: _uhb.x2 + 3, z: _cz, d: _uhb.x2 - _cx },
                        { dir: 'north', x: _cx, z: _uhb.z1 - 3, d: _cz - _uhb.z1 },
                        { dir: 'south', x: _cx, z: _uhb.z2 + 3, d: _uhb.z2 - _cz },
                    ];
                    _dists.sort((a, b) => a.d - b.d);
                    const _exit = _dists[0];
                    log(bot, `Moving ${_exit.dir} to exit house area...`);
                    try {
                        await goToPosition(bot, _exit.x, curPos.y, _exit.z, 2);
                    } catch(_me) {
                        log(bot, `Horizontal escape failed: ${_me.message}`);
                    }
                    if (bot.interrupt_code) { bot._pillarPreUsed = false; return false; }
                }
                log(bot, 'Underground detected. Going to surface before navigation...');
                const reached = await goToSurface(bot);
                if (reached) {
                    log(bot, 'Reached surface, now navigating to target...');
                }
            } catch (e) {
                log(bot, `Pre-navigation surface failed: ${e.message}`);
            }
            bot._pillarPreUsed = false;
        }
    }

    const target = new Vec3(x, y, z);
    const WAYPOINT_DIST = 30;
    const MAX_STUCK = 4;
    const SEGMENT_TIMEOUT_MS = 25000; // [mindaxis-patch:long-distance-nav]
    const DIRECT_TIMEOUT_MS = 30000;
    console.log('[goto-trace] precheck done, starting nav');

    // progress-timeout: 進捗ベースのタイムアウト（移動していなければスタック判定）
    async function goWithTimeout(goal, timeoutMs) {
        // [#18 fix] 既に中断要求が出ている場合は即 throw
        if (bot.interrupt_code) throw new Error('interrupted');

        let hardTimer, progressTimer;
        let lastPos = bot.entity.position.clone();
        let stuckTicks = 0;
        const STUCK_CHECK_MS = 3000; // [mindaxis-patch:stuck-tolerance]
        const STUCK_MAX = 4;

        const stuckPromise = new Promise((_, reject) => {
            hardTimer = setTimeout(() => {
                try { bot.pathfinder.stop(); } catch(_) {}
                try { bot.pathfinder.setGoal(null); } catch(_) {}
                reject(new Error('navigation_timeout'));
            }, timeoutMs);

            progressTimer = setInterval(() => {
                // [#18 fix] interrupt_code チェック — モード割り込みに即応答
                if (bot.interrupt_code) {
                    try { bot.pathfinder.stop(); } catch(_) {}
                    try { bot.pathfinder.setGoal(null); } catch(_) {}
                    clearInterval(progressTimer);
                    reject(new Error('interrupted'));
                    return;
                }
                const curPos = bot.entity.position;
                const movedXZ = Math.sqrt((curPos.x - lastPos.x) ** 2 + (curPos.z - lastPos.z) ** 2);
                if (movedXZ < 0.5) {
                    stuckTicks++;
                    if (stuckTicks >= STUCK_MAX) {
                        try { bot.pathfinder.stop(); } catch(_) {}
                        try { bot.pathfinder.setGoal(null); } catch(_) {}
                        clearInterval(progressTimer);
                        reject(new Error('navigation_stuck'));
                    }
                } else {
                    stuckTicks = 0;
                }
                lastPos = curPos.clone();
            }, STUCK_CHECK_MS);
        });

        try {
            const result = await Promise.race([goToGoal(bot, goal), stuckPromise]);
            clearTimeout(hardTimer);
            clearInterval(progressTimer);
            return result;
        } catch (err) {
            clearTimeout(hardTimer);
            clearInterval(progressTimer);
            throw err;
        }
    }

    const checkDigProgress = () => {
        if (bot.targetDigBlock) {
            const targetBlock = bot.targetDigBlock;
            const itemId = bot.heldItem ? bot.heldItem.type : null;
            if (!targetBlock.canHarvest(itemId)) {
                log(bot, `Pathfinding stopped: Cannot break ${targetBlock.name} with current tools.`);
                bot.pathfinder.stop();
                bot.stopDigging();
            }
        }
    };
    
    const progressInterval = setInterval(checkDigProgress, 1000);
    
    try {
        // [mindaxis-patch:goto-nav-upgrade] water-pre-nav + waypoint nav + manual/pillar fallbacks
        // [#18 fix] interrupt helper — 全 await 後にチェック
        const _ic = () => bot.interrupt_code;
        // [#18 fix] 冒頭で即チェック — 既に中断済みなら一切の処理をスキップ
        if (_ic()) return false;
        // [mindaxis-patch:goto-total-timeout] 全体タイムアウト（90秒）— コマンドが返らないと self-prompter が回らない
        const _gotoStartTime = Date.now();
        const _GOTO_TOTAL_TIMEOUT = 90000;
        // [mindaxis-patch:goto-timeout-outer-scope] var でブロック外からもアクセス可能に
        var _checkTotalTimeout = () => {
            if (Date.now() - _gotoStartTime > _GOTO_TOTAL_TIMEOUT) {
                log(bot, 'goToPosition total timeout (90s). Aborting navigation.');
                try { bot.pathfinder.stop(); } catch(_e) {}
                return true;
            }
            return false;
        };
        // [mindaxis-patch:no-water-prewalk] 水中でも pathfinder に直接任せる
        // [water-preswim] 水中なら手動で岸まで泳いでから pathfinder
        if (_ic()) { clearInterval(progressInterval); return false; }
        {
            const _wpFeet = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)));
            if (_wpFeet && (_wpFeet.name === 'water' || _wpFeet.name === 'flowing_water')) {
                console.log('[goto-trace] in water, swimming to shore first');
                for (let _swimI = 0; _swimI < 40; _swimI++) {
                    if (_ic() || _checkTotalTimeout()) break;
                    const _scp = bot.entity.position;
                    const _sfb = bot.blockAt(new Vec3(Math.floor(_scp.x), Math.floor(_scp.y), Math.floor(_scp.z)));
                    if (!_sfb || (_sfb.name !== 'water' && _sfb.name !== 'flowing_water')) {
                        console.log('[goto-trace] reached land after ' + _swimI + ' swim ticks');
                        break;
                    }
                    await bot.lookAt(new Vec3(x, _scp.y + 0.5, z));
                    bot.setControlState('forward', true);
                    bot.setControlState('jump', true);
                    await new Promise(r => setTimeout(r, 500));
                }
                bot.setControlState('forward', false);
                bot.setControlState('jump', false);
            }
        }
        if (_ic()) { clearInterval(progressInterval); return false; }
        let totalDist = bot.entity.position.distanceTo(target);
        console.log('[goto-trace] totalDist=' + Math.round(totalDist) + ' WAYPOINT_DIST=' + WAYPOINT_DIST);
        if (totalDist <= WAYPOINT_DIST * 1.5) {
            let directOk = false;
            try {
                await goWithTimeout(new pf.goals.GoalNear(x, y, z, min_distance), DIRECT_TIMEOUT_MS);
                directOk = true;
            } catch (e) {
                if (_ic()) { clearInterval(progressInterval); return false; }
                log(bot, `Direct navigation failed: ${e.message}, trying manual nav...`);
            }
            if (!directOk && !_ic()) {
                const beforeFallback = bot.entity.position.clone();
                await manualWalkToward(bot, x, z, 10);
                if (_ic()) { clearInterval(progressInterval); return false; }
                const movedDist = bot.entity.position.distanceTo(beforeFallback);
                if (movedDist > 3) {
                    log(bot, `Manual nav moved ${Math.round(movedDist)} blocks, retrying pathfinder...`);
                    try {
                        await goWithTimeout(new pf.goals.GoalNear(x, y, z, min_distance), DIRECT_TIMEOUT_MS);
                    } catch (e2) {
                        if (_ic()) { clearInterval(progressInterval); return false; }
                        log(bot, `Retry also failed: ${e2.message}`);
                    }
                }
            }
        } else {
            console.log('[goto-trace] Long distance ' + Math.round(totalDist) + ' blocks');
            log(bot, `Long distance (${Math.round(totalDist)} blocks), using waypoints.`);
            let stuckCount = 0;
            while (true) {
                if (_ic()) break;
                if (_checkTotalTimeout()) break;
                const pos = bot.entity.position;
                const remaining = pos.distanceTo(target);
                console.log('[goto-trace] waypoint loop: remaining=' + Math.round(remaining) + ' pos=(' + Math.round(pos.x) + ',' + Math.round(pos.y) + ',' + Math.round(pos.z) + ')');
                if (remaining <= min_distance + 1) break;
                if (remaining <= WAYPOINT_DIST * 1.5) {
                    console.log('[goto-trace] final approach');
                    try {
                        await goWithTimeout(new pf.goals.GoalNear(x, y, z, min_distance), DIRECT_TIMEOUT_MS);
                    } catch (e) {
                        if (_ic()) break;
                        console.log('[goto-trace] final approach failed: ' + e.message);
                        log(bot, `Final approach failed: ${e.message}`);
                    }
                    break;
                }
                const dx = x - pos.x;
                const dz = z - pos.z;
                const dist2d = Math.sqrt(dx * dx + dz * dz);
                const wpX = pos.x + (dx / dist2d) * WAYPOINT_DIST;
                const wpZ = pos.z + (dz / dist2d) * WAYPOINT_DIST;
                console.log('[goto-trace] segment to (' + Math.round(wpX) + ',' + Math.round(wpZ) + ') timeout=' + SEGMENT_TIMEOUT_MS);
                log(bot, `Waypoint: (${Math.round(wpX)}, ${Math.round(wpZ)}), ${Math.round(remaining)} blocks left.`);
                const prevPos = pos.clone();
                try {
                    await goWithTimeout(new pf.goals.GoalXZ(wpX, wpZ), SEGMENT_TIMEOUT_MS); // [mindaxis-patch:waypoint-goalxz] Y不問
                    console.log('[goto-trace] segment OK, moved to (' + Math.round(bot.entity.position.x) + ',' + Math.round(bot.entity.position.z) + ')');
                    stuckCount = 0;
                } catch (e) {
                    console.log('[goto-trace] segment FAILED: ' + e.message);
                    if (_ic()) break;
                    const cur = bot.entity.position;
                    const movedXZ = Math.sqrt((cur.x - prevPos.x) ** 2 + (cur.z - prevPos.z) ** 2);
                    if (movedXZ < 5) {
                        stuckCount++;
                        log(bot, `Stuck at waypoint (${stuckCount}/${MAX_STUCK}), trying detour...`);
                        if (stuckCount >= MAX_STUCK) {
                            log(bot, `Cannot navigate after ${stuckCount} failed segments.`);
                            clearInterval(progressInterval);
                            return false;
                        }
                        log(bot, '[detour] Trying manual navigation...');
                        await manualWalkToward(bot, x, z, 5);
                        if (_ic()) break;
                    } else {
                        stuckCount = 0;
                    }
                    continue;
                }
                // [#13 fix] オーバーシュート検出: 目標から離れたらループ中断
                const afterDist = bot.entity.position.distanceTo(target);
                if (afterDist > remaining + 5) {
                    log(bot, `Overshoot detected (${Math.round(remaining)} → ${Math.round(afterDist)}). Switching to final approach.`);
                    break;
                }
            }
        }
        if (_ic()) { clearInterval(progressInterval); return false; }
        clearInterval(progressInterval);
        const finalDist = bot.entity.position.distanceTo(target);
        if (finalDist <= min_distance + 1) {
            // [mindaxis-patch:door-front-auto-enter] ドア外側到達 → 自動入室
            try {
                const _deHs = bot._houseStructure;
                if (_deHs && _deHs.bounds && _deHs.door && !bot._doorEntryInProgress) {
                    const _dePos = bot.entity.position;
                    const _deB = _deHs.bounds;
                    const _deInside = _dePos.x > _deB.x1 && _dePos.x < _deB.x2 && _dePos.z > _deB.z1 && _dePos.z < _deB.z2;
                    if (!_deInside) {
                        const _deF = _deHs.door.facing;
                        const _deFx = _deHs.door.x + (_deF==='east'?1:_deF==='west'?-1:0);
                        const _deFz = _deHs.door.z + (_deF==='south'?1:_deF==='north'?-1:0);
                        const _deDist = Math.sqrt((_dePos.x-_deFx)**2 + (_dePos.z-_deFz)**2);
                        if (_deDist <= 3) {
                            bot._doorEntryInProgress = true;
                            try {
                                const _doorBlk = bot.blockAt(new Vec3(_deHs.door.x, _deB.y+1, _deHs.door.z));
                                if (_doorBlk && _doorBlk.name.includes('door')) {
                                    const _props = _doorBlk.getProperties ? _doorBlk.getProperties() : {};
                                    if (_props.open === false || _props.open === 'false') {
                                        await bot.activateBlock(_doorBlk);
                                        await new Promise(r => setTimeout(r, 300));
                                    }
                                }
                                let _insX = _deHs.door.x + 0.5, _insZ = _deHs.door.z + 0.5;
                                if (_deF === 'west') _insX += 2; else if (_deF === 'east') _insX -= 2;
                                else if (_deF === 'north') _insZ += 2; else if (_deF === 'south') _insZ -= 2;
                                await bot.lookAt(new Vec3(_insX, _deB.y+1, _insZ));
                                bot.setControlState('forward', true);
                                for (let _ei = 0; _ei < 12; _ei++) {
                                    await new Promise(r => setTimeout(r, 200));
                                    if (bot.interrupt_code) break;
                                    const _cp = bot.entity.position;
                                    if (_cp.x > _deB.x1 && _cp.x < _deB.x2 && _cp.z > _deB.z1 && _cp.z < _deB.z2) break;
                                }
                                bot.setControlState('forward', false);
                                log(bot, 'Entered house through door (auto).');
                            } catch(_e) { bot.setControlState('forward', false); }
                            bot._doorEntryInProgress = false;
                        }
                    }
                }
            } catch(_dee) {}
            log(bot, `You have reached at ${x}, ${y}, ${z}.`);
            return true;
        } else {
            if (_ic() || _checkTotalTimeout()) return false;
            if (!bot._manualFallbackUsed) {
                bot._manualFallbackUsed = true;
                log(bot, 'Pathfinder failed. Trying manual navigation toward target...');
                const manualOk = await manualWalkToward(bot, x, z, 8);
                bot._manualFallbackUsed = false;
                if (_ic()) return false;
                if (manualOk) {
                    const afterManual = bot.entity.position.distanceTo(target);
                    if (afterManual <= min_distance + 1) {
                        log(bot, 'Reached target via manual navigation!');
                        return true;
                    }
                    log(bot, 'Manual nav moved closer, retrying pathfinder...');
                    try {
                        await goWithTimeout(new pf.goals.GoalNear(x, y, z, min_distance), DIRECT_TIMEOUT_MS);
                        const d = bot.entity.position.distanceTo(target);
                        if (d <= min_distance + 1) {
                            log(bot, 'Reached target after manual+pathfinder!');
                            return true;
                        }
                    } catch(e) {}
                    if (_ic()) return false;
                }
            }
            const yDiff = y - bot.entity.position.y;
            const _fbFeet = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)));
            const _fbInWater = _fbFeet && (_fbFeet.name === 'water' || _fbFeet.name === 'flowing_water');
            if ((yDiff > 2 || _fbInWater) && !bot._pillarFallbackUsed && !_ic()) {
                log(bot, `${_fbInWater ? 'In water' : 'Target is ' + Math.round(yDiff) + ' blocks above'}. Attempting to reach surface...`);
                bot._pillarFallbackUsed = true;
                try {
                    const surfaceReached = await goToSurface(bot);
                    if (surfaceReached && !_ic()) {
                        log(bot, 'Reached surface, retrying navigation...');
                        bot._pillarFallbackUsed = false;
                        return await goToPosition(bot, x, y, z, min_distance);
                    }
                } catch (e) {
                    log(bot, `Pillar fallback failed: ${e.message}`);
                }
                bot._pillarFallbackUsed = false;
            }
            log(bot, `Unable to reach ${x}, ${y}, ${z}, you are ${Math.round(finalDist)} blocks away.`);
            return false;
        }
    } catch (err) {
        log(bot, `Pathfinding stopped: ${err.message}.`);
        clearInterval(progressInterval);
        return false;
    }
}

export async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
    /**
     * Navigate to the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to navigate to.
     * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
     * @param {number} range, the range to look for the block. Defaults to 64.
     * @returns {Promise<boolean>} true if the block was reached, false otherwise.
     * @example
     * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
     * **/
    const MAX_RANGE = 512;
    if (range > MAX_RANGE) {
        log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
        range = MAX_RANGE;
    }
    let block = null;
    // [mindaxis-patch:location-memory-first] 記憶がある場合はまずそこへ移動（200ブロック以内）
    if (blockType !== 'water' && blockType !== 'lava') {
        try {
            const _fsf = await import('fs');
            const _memPathF = './bots/' + bot.username + '/location_memory.json';
            if (_fsf.existsSync(_memPathF)) {
                const _lmf = JSON.parse(_fsf.readFileSync(_memPathF, 'utf8'));
                const _resf = (_lmf.resources || {})[blockType];
                if (_resf && _resf.length > 0) {
                    const _bposf = bot.entity.position;
                    _resf.sort((a,b) => ((a.x-_bposf.x)**2+(a.z-_bposf.z)**2) - ((b.x-_bposf.x)**2+(b.z-_bposf.z)**2));
                    const _rlocf = _resf[0];
                    const _distf = Math.sqrt((_rlocf.x-_bposf.x)**2+(_rlocf.z-_bposf.z)**2);
                    if (_distf > range && _distf <= 200) {
                        log(bot, `Heading to remembered ${blockType} at (${_rlocf.x}, ${_rlocf.z}), ~${_rlocf.count} blocks (${Math.round(_distf)}m away).`);
                        await goToPosition(bot, _rlocf.x, _rlocf.y || _bposf.y, _rlocf.z, 5);
                    }
                }
            }
        } catch(_lmErrF) {}
    }
    if (blockType === 'water' || blockType === 'lava') {
        let blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType && block.metadata === 0, range, 1);
        if (blocks.length === 0) {
            log(bot, `Could not find any source ${blockType} in ${range} blocks, looking for uncollectable flowing instead...`);
            blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType, range, 1);
        }
        block = blocks[0];
    }
    else {
        // [mindaxis-patch:surface-prefer-v6] 地上ブロック優先 + 鉱石は地下フィルタ無効
        const botY = bot.entity.position.y;
        // 鉱石・深層鉱石はY制限なし（地下採掘のため）
        const _isOre = blockType.endsWith('_ore') || blockType.startsWith('deepslate_');
        const minY = _isOre ? -64 : Math.max(botY - 20, 50);
        const candidates = world.getNearestBlocks(bot, blockType, range, 50);
        console.log('[search-dbg] ' + blockType + ': ' + candidates.length + ' raw candidates within ' + range + ' blocks' + (_isOre ? ' (ore mode, no minY filter)' : ' minY=' + minY));
        const _isWater = n => n && (n.name === 'water' || n.name === 'flowing_water');
        const surfaceCandidates = candidates.filter(b => {
            if (b.position.y < minY) { return false; }
            const _above1 = bot.blockAt(b.position.offset(0, 1, 0));
            const _above2 = bot.blockAt(b.position.offset(0, 2, 0));
            if (_isWater(_above1) && _isWater(_above2)) { console.log('[search-dbg] SKIP submerged: ' + b.position); return false; }
            const _belowB = bot.blockAt(b.position.offset(0, -1, 0));
            if (_isWater(_belowB)) { console.log('[search-dbg] SKIP water-below: ' + b.position); return false; }
            const _adjWater = [
                bot.blockAt(b.position.offset(1, 1, 0)),
                bot.blockAt(b.position.offset(-1, 1, 0)),
                bot.blockAt(b.position.offset(0, 1, 1)),
                bot.blockAt(b.position.offset(0, 1, -1)),
            ].filter(_isWater).length;
            if (_adjWater >= 3) { console.log('[search-dbg] SKIP water-adj: ' + b.position); return false; }
            return true;
        });
        console.log('[search-dbg] ' + surfaceCandidates.length + ' surface candidates remain');
        block = surfaceCandidates[0] || null;
        if (surfaceCandidates.length > 1) {
            bot._mindaxisSurfaceCandidates = surfaceCandidates.slice(1);
        }
    }
    // [mindaxis-patch:location-memory-lookup] 記憶済み資源の場所を確認
    if (!block) {
        try {
            const _fs = await import('fs');
            const _memPath = './bots/' + bot.username + '/location_memory.json';
            if (_fs.existsSync(_memPath)) {
                const _lm = JSON.parse(_fs.readFileSync(_memPath, 'utf8'));
                const _res = _lm.resources || {};
                if (_res[blockType] && _res[blockType].length > 0) {
                    const _bpos = bot.entity.position;
                    _res[blockType].sort((a,b) => ((a.x-_bpos.x)**2+(a.z-_bpos.z)**2) - ((b.x-_bpos.x)**2+(b.z-_bpos.z)**2));
                    const _rloc = _res[blockType][0];
                    log(bot, `I remember ${blockType} at (${_rloc.x}, ${_rloc.z}), ~${_rloc.count} blocks. Going there...`);
                    await goToPosition(bot, _rloc.x, _rloc.y || _bpos.y, _rloc.z, 5);
                    block = world.getNearestBlock(bot, blockType, 32);
                    if (block) {
                        log(bot, `Found ${blockType} at remembered location!`);
                    } else {
                        _res[blockType] = _res[blockType].filter(l => Math.abs(l.x-_rloc.x)>=5 || Math.abs(l.z-_rloc.z)>=5);
                        if (_res[blockType].length === 0) delete _res[blockType];
                        _lm.resources = _res;
                        _fs.writeFileSync(_memPath, JSON.stringify(_lm, null, 2), 'utf8');
                        log(bot, `Resource at (${_rloc.x}, ${_rloc.z}) depleted. Removed from memory.`);
                    }
                }
            }
        } catch(_lmErr) {}
    }
    if (!block) {
        // [mindaxis-patch:auto-explore] 木が見つからない時は自動で遠くへ探索
        const woodTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
        if (woodTypes.includes(blockType)) {
            log(bot, `Could not find any ${blockType} nearby. Exploring to find trees...`);
            // ランダムな方向に100ブロック移動して探索
            const angle = Math.random() * 2 * Math.PI;
            const distance = 80 + Math.random() * 40; // 80-120ブロック
            const pos = bot.entity.position;
            const targetX = Math.round(pos.x + Math.cos(angle) * distance);
            const targetZ = Math.round(pos.z + Math.sin(angle) * distance);
            try {
                await goToPosition(bot, targetX, pos.y, targetZ, 5);
                log(bot, `Explored to (${targetX}, ${targetZ}). Looking for ${blockType} again...`);
            } catch (e) {
                log(bot, `Exploration interrupted: ${e.message}`);
            }
        } else {
            log(bot, `Could not find any ${blockType} in ${range} blocks.`);
        }
        return false;
    }
    // [mindaxis-patch:retry-candidates] 到達失敗時は次の候補を試す
    const candidates = bot._mindaxisSurfaceCandidates || [];
    let allCandidates = [block, ...candidates];

    for (let i = 0; i < Math.min(allCandidates.length, 5); i++) {
        const targetBlock = allCandidates[i];
        log(bot, `Found ${blockType} at ${targetBlock.position}. Navigating... (candidate ${i + 1}/${Math.min(allCandidates.length, 5)})`);
        try {
            const reached = await goToPosition(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, min_distance);
            if (reached) {
                delete bot._mindaxisSurfaceCandidates;
                return true;
            }
        } catch (e) {
            log(bot, `Could not reach ${blockType} at ${targetBlock.position}: ${e.message}. Trying next...`);
        }
    }

    // 全候補に到達できなかった場合は探索（木の場合のみ）
    const woodTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
    if (woodTypes.includes(blockType)) {
        log(bot, `All ${blockType} candidates unreachable. Exploring...`);
        const angle = Math.random() * 2 * Math.PI;
        const distance = 80 + Math.random() * 40;
        const pos = bot.entity.position;
        try {
            await goToPosition(bot, Math.round(pos.x + Math.cos(angle) * distance), pos.y, Math.round(pos.z + Math.sin(angle) * distance), 5);
        } catch (e) { /* ignore */ }
    }

    delete bot._mindaxisSurfaceCandidates;
    return false;
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance} blocks away.`);
    await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
    return true;
}

export async function goToPlayer(bot, username, distance=3) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
     **/
    if (bot.username === username) {
        log(bot, `You are already at ${username}.`);
        return true;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }

    distance = Math.max(distance, 0.5);
    const goal = new pf.goals.GoalFollow(player, distance);

    await goToGoal(bot, goal, true);

    log(bot, `You have reached ${username}.`);
}


export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    let player = bot.players[username].entity
    if (!player)
        return false;

    const move = new pf.Movements(bot);
    move.digCost = 10;
    bot.pathfinder.setMovements(move);
    let doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    log(bot, `You are now actively following player ${username}.`);


    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // in cheat mode, if the distance is too far, teleport to the player
        const distance_from_player = bot.entity.position.distanceTo(player.position);

        const teleport_distance = 100;
        const ignore_modes_distance = 30; 
        const nearby_distance = distance + 2;

        if (distance_from_player > teleport_distance && bot.modes.isOn('cheat')) {
            // teleport with cheat mode
            await goToPlayer(bot, username);
        }
        else if (distance_from_player > ignore_modes_distance) {
            // these modes slow down the bot, and we want to catch up
            bot.modes.pause('item_collecting');
            bot.modes.pause('hunting');
            bot.modes.pause('torch_placing');
        }
        else if (distance_from_player <= ignore_modes_distance) {
            bot.modes.unpause('item_collecting');
            bot.modes.unpause('hunting');
            bot.modes.unpause('torch_placing');
        }

        if (distance_from_player <= nearby_distance) {
            clearInterval(doorCheckInterval);
            doorCheckInterval = null;
            /* [mindaxis-patch:no-unstuck-pause] */ // unstuck mode deleted
            bot.modes.pause('elbow_room');
        }
        else {
            if (!doorCheckInterval) {
                doorCheckInterval = startDoorInterval(bot);
            }
            /* [mindaxis-patch:no-unstuck-unpause] */ // unstuck mode deleted
            bot.modes.unpause('elbow_room');
        }
    }
    clearInterval(doorCheckInterval);
    return true;
}


export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position;
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));

    if (bot.modes.isOn('cheat')) {
        const move = new pf.Movements(bot);
        const path = await bot.pathfinder.getPathTo(move, inverted_goal, 10000);
        let last_move = path.path[path.path.length-1];
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            return true;
        }
    }

    // [mindaxis-patch:moveaway-surface-first] 水中なら goToSurface で脱出してから移動を継続
    if (bot.entity.isInWater) {
        log(bot, 'Underwater detected in moveAway, surfacing first...');
        await goToSurface(bot);
        log(bot, 'moveAway: goToSurface done, continuing moveAway...');
        // 脱出後に pos を更新して移動開始（return しない）
    }

    // [mindaxis-patch:moveaway-concrete-goal] GoalInvert → 8方向の具体座標 GoalNear に変更
    // GoalInvert は A* 探索空間が無限大になりタイムアウトしやすい。
    // 具体的なゴール座標を 8方向で順番に試し、8s で次方向へ切り替える。
    // 共有ワールドマップ(terrainSuggestExplore)で未探索方向を優先、次に水域回避。
    let _maAngles;
    if (bot._terrainSuggestExplore) {
        // 未探索タイル数が少ない方向を優先（共有ワールドマップ参照）
        const _maSuggested = bot._terrainSuggestExplore(pos.x, pos.z, Math.max(distance * 2, 500));
        _maAngles = _maSuggested.map(d => Math.atan2(d.dz, d.dx));
    } else {
        _maAngles = Array.from({length: 8}, (_, i) => (Math.random() * Math.PI * 2) + (i / 8) * Math.PI * 2);
        if (bot._terrainCache && bot._terrainAnalyzeDir) {
            _maAngles.sort((a, b) => {
                const _stepSz = Math.floor(distance / 5);
                const _da = bot._terrainAnalyzeDir(pos.x, pos.z, a * 180 / Math.PI, 5, _stepSz);
                const _db = bot._terrainAnalyzeDir(pos.x, pos.z, b * 180 / Math.PI, 5, _stepSz);
                return _da.water - _db.water;
            });
        }
    }
    // 最初の方向（最も水域が少ない）は十分なタイムアウトを与える。残りは短め。
    const _maMainTimeout = Math.min(distance * 300, 90000); // 200→60s, 300→90s
    const _maFallbackTimeout = 8000;
    for (let _mai = 0; _mai < 8; _mai++) {
        if (bot.interrupt_code) break;
        const _maAngle = _maAngles[_mai];
        const _maTx = Math.round(pos.x + distance * Math.cos(_maAngle));
        const _maTz = Math.round(pos.z + distance * Math.sin(_maAngle));
        // 目標XZの地表Y推定（±10ブロック走査、チャンク未ロード時は現在Y）
        let _maTy = Math.round(pos.y);
        for (let _dy = -10; _dy <= 10; _dy++) {
            const _b0 = bot.blockAt(new Vec3(_maTx, _maTy + _dy - 1, _maTz));
            const _b1 = bot.blockAt(new Vec3(_maTx, _maTy + _dy, _maTz));
            if (_b0 && _b0.solid && _b1 && !_b1.solid) { _maTy = _maTy + _dy; break; }
        }
        // [mindaxis-patch:moveaway-segmented] 最優先方向は60ブロック区切りで分割パスファインド
        if (_mai === 0) {
            const _maSegSize = 60;
            const _maNumSegs = Math.ceil(distance / _maSegSize);
            for (let _maSeg = 1; _maSeg <= _maNumSegs && !bot.interrupt_code; _maSeg++) {
                const _maSegDist = _maSeg * _maSegSize;
                const _maStx = Math.round(pos.x + _maSegDist * Math.cos(_maAngle));
                const _maStz = Math.round(pos.z + _maSegDist * Math.sin(_maAngle));
                let _maSTy = Math.round(pos.y);
                for (let _sdy = -10; _sdy <= 10; _sdy++) {
                    const _b0 = bot.blockAt(new Vec3(_maStx, _maSTy + _sdy - 1, _maStz));
                    const _b1 = bot.blockAt(new Vec3(_maStx, _maSTy + _sdy, _maStz));
                    if (_b0 && _b0.solid && _b1 && !_b1.solid) { _maSTy = _maSTy + _sdy; break; }
                }
                const _maSegGoal = new pf.goals.GoalNear(_maStx, _maSTy, _maStz, 5);
                const _maSegTimer = setTimeout(() => { try { bot.pathfinder.stop(); } catch(_) {} }, 30000);
                try { await goToGoal(bot, _maSegGoal); } catch(_) {} finally { clearTimeout(_maSegTimer); }
                // [mindaxis-patch:moveaway-water-escape] セグメント後に水中なら即 goToSurface して次セグメントへ
                if (bot.entity.isInWater) {
                    log(bot, 'moveAway segment ended in water — calling goToSurface...');
                    try { await goToSurface(bot); } catch(_) {}
                    if (bot.entity.isInWater) break; // 脱出できなければそのセグメント方向を諦める
                }
            }
        } else {
            const _maGoal = new pf.goals.GoalNear(_maTx, _maTy, _maTz, 5);
            const _maTimer = setTimeout(() => { try { bot.pathfinder.stop(); } catch(_) {} }, _maFallbackTimeout);
            try { await goToGoal(bot, _maGoal); } catch(_) {} finally { clearTimeout(_maTimer); }
        }
        // 十分移動できたら終了（85%以上達成で OK）
        if (bot.entity.position.distanceTo(pos) >= distance * 0.85) break;
    }
    let new_pos = bot.entity.position;
    let _actualDist = Math.round(new_pos.distanceTo(pos));

    // [mindaxis-patch:moveaway-boat-fallback] 距離不足なら自動ボートで水を渡る
    if (_actualDist < distance * 0.3 && !bot.interrupt_code) {
        log(bot, `Only moved ${_actualDist} blocks (target: ${distance}). Trying boat crossing...`);
        try {
            // ボートを取得 or 作成
            let _mabItem = bot.inventory.items().find(i => i.name.includes('boat') && !i.name.includes('chest'));
            if (!_mabItem) {
                const _mabPlanks = bot.inventory.items().filter(i => i.name.includes('planks')).reduce((s, i) => s + i.count, 0);
                if (_mabPlanks >= 5) {
                    await craftRecipe(bot, 'oak_boat');
                    _mabItem = bot.inventory.items().find(i => i.name.includes('boat') && !i.name.includes('chest'));
                }
            }
            if (_mabItem) {
                // 地形キャッシュがあれば水域の少ない方向を選ぶ、なければランダム
                const _mabAngle = _maAngles[0]; // 既にソート済み（水域の少ない順）
                const _mabTx = Math.round(pos.x + distance * Math.cos(_mabAngle));
                const _mabTz = Math.round(pos.z + distance * Math.sin(_mabAngle));
                // 近くの水ブロックを探す
                const _mabWaterId = bot.registry.blocksByName['water']?.id;
                const _mabWater = _mabWaterId ? bot.findBlock({ matching: _mabWaterId, maxDistance: 30 }) : null;
                if (_mabWater) {
                    // 水辺に移動してボートを設置
                    const _mabGoal = new pf.goals.GoalNear(_mabWater.position.x, _mabWater.position.y, _mabWater.position.z, 2);
                    const _mabT = setTimeout(() => { try { bot.pathfinder.stop(); } catch(_) {} }, 10000);
                    try { await goToGoal(bot, _mabGoal); } catch(_) {} finally { clearTimeout(_mabT); }
                    // ボートを装備・設置
                    _mabItem = bot.inventory.items().find(i => i.name.includes('boat') && !i.name.includes('chest'));
                    if (_mabItem) {
                        await bot.equip(_mabItem, 'hand').catch(() => {});
                        const _mabEnt = await bot.placeEntity(_mabWater, new Vec3(0, 1, 0)).catch(() => null);
                        if (_mabEnt) {
                            bot.mount(_mabEnt);
                            await new Promise((res, rej) => {
                                const t = setTimeout(() => rej(new Error('mount timeout')), 5000);
                                bot.once('mount', () => { clearTimeout(t); res(); });
                            }).catch(() => {});
                            // ボートでターゲットへ向かう
                            const _mabEnd = Date.now() + 90000;
                            let _mabStuck = 0, _mabLast = bot.entity.position.clone(), _mabLand = 0;
                            while (Date.now() < _mabEnd && bot.vehicle && !bot.interrupt_code) {
                                const _cp = bot.entity.position;
                                const _ddx = _mabTx - _cp.x, _ddz = _mabTz - _cp.z;
                                if (Math.sqrt(_ddx*_ddx+_ddz*_ddz) < 15) break;
                                if (_cp.distanceTo(_mabLast) < 0.3) { if (++_mabStuck > 40) break; } else _mabStuck = 0;
                                _mabLast = _cp.clone();
                                const _bel = bot.blockAt(_cp.offset(0, -1, 0));
                                if (_bel && _bel.name !== 'water' && _bel.boundingBox === 'block') { if (++_mabLand > 15) break; } else _mabLand = 0;
                                await bot.look(Math.atan2(-_ddx, -_ddz), 0);
                                bot.moveVehicle(0, 1);
                                await new Promise(r => setTimeout(r, 100));
                            }
                            // 降船
                            if (bot.vehicle) { try { bot.dismount(); await new Promise(r => setTimeout(r, 500)); } catch(_) {} }
                            // ボート回収
                            if (bot.entities[_mabEnt.id]) {
                                await bot.unequip('hand').catch(() => {});
                                for (let _bi = 0; _bi < 8; _bi++) {
                                    if (!bot.entities[_mabEnt.id]) break;
                                    await bot.attack(bot.entities[_mabEnt.id]);
                                    await new Promise(r => setTimeout(r, 400));
                                }
                            }
                            new_pos = bot.entity.position;
                            _actualDist = Math.round(new_pos.distanceTo(pos));
                            log(bot, `Boat crossing done. Moved ${_actualDist} blocks from start.`);
                        }
                    }
                } else {
                    log(bot, 'No water nearby for boat. Cannot cross.');
                }
            } else {
                log(bot, 'No boat and not enough planks to craft one. Collect 5 oak_planks first.');
            }
        } catch (_mabErr) {
            log(bot, 'Boat fallback error: ' + _mabErr.message);
        }
    }

    log(bot, `Moved away from ${pos.floored()} to ${new_pos.floored()} (${_actualDist} blocks).`);
    return true;
}

export async function moveAwayFromEntity(bot, entity, distance=16) {
    /**
     * Move away from the given entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to move away from.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     **/
    let goal = new pf.goals.GoalFollow(entity, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(inverted_goal);
    return true;
}

export async function avoidEnemies(bot, distance=16) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    bot.modes.pause('self_preservation'); // prevents damage-on-low-health from interrupting the bot
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
    while (enemy) {
        const follow = new pf.goals.GoalFollow(enemy, distance+1); // move a little further away
        const inverted_goal = new pf.goals.GoalInvert(follow);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        bot.pathfinder.setGoal(inverted_goal, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
        if (bot.interrupt_code) {
            break;
        }
        if (enemy && bot.entity.position.distanceTo(enemy.position) < 3) {
            await attackEntity(bot, enemy, false);
        }
    }
    bot.pathfinder.stop();
    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    /* [mindaxis-patch:no-unstuck-pause] */ // unstuck mode deleted
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    if (!door_pos) {
        for (let door_type of ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
                               'mangrove_door', 'cherry_door', 'bamboo_door', 'crimson_door', 'warped_door']) {
            door_pos = world.getNearestBlock(bot, door_type, 16).position;
            if (door_pos) break;
        }
    } else {
        door_pos = Vec3(door_pos.x, door_pos.y, door_pos.z);
    }
    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    bot.pathfinder.setGoal(new pf.goals.GoalNear(door_pos.x, door_pos.y, door_pos.z, 1));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (bot.pathfinder.isMoving()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    let door_block = bot.blockAt(door_pos);
    await bot.lookAt(door_pos);
    if (!door_block._properties.open)
        await bot.activateBlock(door_block);
    
    bot.setControlState("forward", true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    bot.setControlState("forward", false);
    await bot.activateBlock(door_block);

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed. If no bed is nearby and bot has a bed in inventory,
     * places it temporarily, sleeps through the night, then picks it back up.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bot slept, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => block.name.includes('bed'),
        maxDistance: 32,
        count: 1
    });

    // [mindaxis-patch:portable-bed] ポータブルベッド: 近くにベッドがなければインベントリから設置
    let portableBedPos = null;
    if (beds.length === 0) {
        const bedItem = bot.inventory.items().find(item => item.name.includes('_bed'));
        if (!bedItem) {
            log(bot, `Could not find a bed to sleep in.`);
            return false;
        }
        const pos = bot.entity.position;
        const px = Math.floor(pos.x), py = Math.floor(pos.y), pz = Math.floor(pos.z);
        const trySpots = [[px, py, pz], [px+1, py, pz], [px-1, py, pz], [px, py, pz+1], [px, py, pz-1]];
        let placed = false;
        for (const [tx, ty, tz] of trySpots) {
            if (await placeBlock(bot, bedItem.name, tx, ty, tz)) { placed = true; break; }
        }
        if (!placed) {
            log(bot, `Could not place bed nearby.`);
            return false;
        }
        const newBeds = bot.findBlocks({
            matching: (block) => block.name.includes('bed'),
            maxDistance: 8,
            count: 1
        });
        if (newBeds.length === 0) {
            log(bot, `Bed placed but could not locate it.`);
            return false;
        }
        beds.push(newBeds[0]);
        portableBedPos = newBeds[0];
        log(bot, `Placed portable bed at ${portableBedPos}.`);
    }

    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    try {
        await bot.sleep(bed);
    } catch(e) {
        log(bot, `Could not sleep: ${e.message}`);
        if (portableBedPos) await breakBlockAt(bot, portableBedPos.x, portableBedPos.y, portableBedPos.z);
        return false;
    }
    log(bot, `You are in bed.`);
    /* [mindaxis-patch:no-unstuck-pause] */ // unstuck mode deleted
    while (bot.isSleeping) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    if (portableBedPos) {
        await breakBlockAt(bot, portableBedPos.x, portableBedPos.y, portableBedPos.z);
        log(bot, `Picked up portable bed.`);
    }
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    let pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    let block = bot.blockAt(pos);
    log(bot, `Planting ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);

    if (bot.modes.isOn('cheat')) {
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        placeBlock(bot, 'farmland', x, y, z);
        placeBlock(bot, seedType, x, y+1, z);
        return true;
    }

    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    // [mindaxis-patch:till-surface-only] 地下では耕せない — 頭上20ブロックが開放されているか確認
    {
        let _underground = false;
        for (let _dy = 1; _dy <= 20; _dy++) {
            const _cb = bot.blockAt(new Vec3(Math.floor(x), Math.floor(y) + _dy, Math.floor(z)));
            if (_cb && _cb.name !== 'air' && _cb.name !== 'cave_air' && _cb.name !== 'water' && _cb.name !== 'flowing_water') {
                _underground = true; break;
            }
        }
        if (_underground) {
            log(bot, `Cannot till underground. Farming must be done on the surface with open sky above.`);
            return false;
        }
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        if (block.name === 'farmland') {
            log(bot, `Land is already farmed with ${above.name}.`);
            return true;
        }
        let broken = await breakBlockAt(bot, x, y+1, z);
        if (!broken) {
            log(bot, `Cannot cannot break above block to till.`);
            return false;
        }
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        let to_equip = hoe?.name || 'diamond_hoe';
        if (!await equip(bot, to_equip)) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let equipped_seeds = await equip(bot, seedType);
        if (!equipped_seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }

        await bot.activateBlock(block);
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

/**
 * Helper function to find and navigate to a villager for trading
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager
 * @returns {Promise<Object|null>} the villager entity if found and reachable, null otherwise
 */
async function findAndGoToVillager(bot, id) {
    id = id+"";
    const entity = bot.entities[id];
    
    if (!entity) {
        log(bot, `Cannot find villager with id ${id}`);
        let entities = world.getNearbyEntities(bot, 16);
        let villager_list = "Available villagers:\n";
        for (let entity of entities) {
            if (entity.name === 'villager') {
                if (entity.metadata && entity.metadata[16] === 1) {
                    villager_list += `${entity.id}: baby villager\n`;
                } else {
                    const profession = world.getVillagerProfession(entity);
                    villager_list += `${entity.id}: ${profession}\n`;
                }
            }
        }
        if (villager_list === "Available villagers:\n") {
            log(bot, "No villagers found nearby.");
            return null;
        }
        log(bot, villager_list);
        return null;
    }
    
    if (entity.entityType !== bot.registry.entitiesByName.villager.id) {
        log(bot, 'Entity is not a villager');
        return null;
    }

    if (entity.metadata && entity.metadata[16] === 1) {
        log(bot, 'This is a baby villager - cannot trade');
        return null;
    }

    // [mindaxis-patch:villager-profession-check] Skip unemployed/nitwit villagers (they cannot trade)
    // metadata villager_data has key 'villagerProfession' (not 'profession')
    const _profMeta = entity.metadata && Object.values(entity.metadata).find(v => v && typeof v === 'object' && 'villagerProfession' in v);
    const _profId = _profMeta != null ? _profMeta.villagerProfession : -1;
    // _profId === -1 means no villager_data (e.g. Wandering Trader) — allow trading
    if (_profId === 0) {
        log(bot, `Villager ${id} is Unemployed (no job site block) - cannot trade. Place a job site block near them to give them a profession (e.g. composter=farmer, lectern=librarian, blast_furnace=armorer, smoker=butcher, cartography_table=cartographer, brewing_stand=cleric, barrel=fisherman, fletching_table=fletcher, loom=shepherd, grindstone=weaponsmith, smithing_table=toolsmith, stonecutter=mason).`);
        return null;
    }
    if (_profId === 11) {
        log(bot, `Villager ${id} is a Nitwit - permanently cannot trade. Find a different villager.`);
        return null;
    }

    // [mindaxis-patch:villager-night-check] Check if it's nighttime (villagers sleep at night)
    const _timeOfDay = bot.time && bot.time.timeOfDay;
    if (_timeOfDay != null && _timeOfDay > 12542 && _timeOfDay < 23459) {
        log(bot, `It is nighttime (time=${_timeOfDay}) - villagers are sleeping. Use !goToBed to sleep until morning, or wait for daylight.`);
        return null;
    }

    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 4) {
        log(bot, `Villager is ${distance.toFixed(1)} blocks away, moving closer...`);
        try {
            /* [mindaxis-patch:no-unstuck-pause] */ // unstuck mode deleted
            const goal = new pf.goals.GoalFollow(entity, 2);
            await goToGoal(bot, goal);
            log(bot, 'Successfully reached villager');
        } catch (err) {
            // [mindaxis-patch:villager-reach-retry] Retry with larger follow distance before giving up
            try {
                const goal2 = new pf.goals.GoalFollow(entity, 5);
                await goToGoal(bot, goal2);
                log(bot, 'Reached close enough to villager');
            } catch (err2) {
                log(bot, `Failed to reach villager ${id} - they may be inside a building or inaccessible. Do NOT retry the same ID. Instead, use !moveAway(30) to find a better position, then !searchForEntity("villager", 50) to get a new villager ID.`);
                console.log(err2);
                return null;
            }
        } finally {
            /* [mindaxis-patch:no-unstuck-unpause] */ // unstuck mode deleted
        }
    }
    
    return entity;
}

/**
 * Show available trades for a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to show trades for
 * @returns {Promise<boolean>} true if trades were shown successfully, false otherwise
 * @example
 * await skills.showVillagerTrades(bot, "123");
 */
export async function showVillagerTrades(bot, id) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        log(bot, `Villager has ${villager.trades.length} available trades:`);
        stringifyTrades(bot, villager.trades).forEach((trade, i) => {
            const tradeInfo = `${i + 1}: ${trade}`;
            console.log(tradeInfo);
            log(bot, tradeInfo);
        });
        
        villager.close();
        return true;
    } catch (err) {
        // [mindaxis-patch:villager-trade-error-msg] Improved error message with actionable advice
        log(bot, `Failed to open villager trading interface: ${err.message}. The villager may be sleeping (try at daytime), have no profession (place a job site block), or be unavailable.`);
        console.log('Villager trading error:', err.message);
        return false;
    }
}

/**
 * Trade with a specified villager
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager to trade with
 * @param {number} index - the index (1-based) of the trade to execute
 * @param {number} count - how many times to execute the trade (optional)
 * @returns {Promise<boolean>} true if trade was successful, false otherwise
 * @example
 * await skills.tradeWithVillager(bot, "123", "1", "2");
 */
export async function tradeWithVillager(bot, id, index, count) {
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        const tradeIndex = parseInt(index) - 1; // Convert to 0-based index
        const trade = villager.trades[tradeIndex];
        
        if (!trade) {
            log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades available.`);
            villager.close();
            return false;
        }
        
        if (trade.disabled) {
            log(bot, `Trade ${index} is currently disabled`);
            villager.close();
            return false;
        }

        const item_2 = trade.inputItem2 ? stringifyItem(bot, trade.inputItem2)+' ' : '';
        log(bot, `Trading ${stringifyItem(bot, trade.inputItem1)} ${item_2}for ${stringifyItem(bot, trade.outputItem)}...`);
        
        const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const requestedCount = count;
        const actualCount = Math.min(requestedCount, maxPossibleTrades);
        
        if (actualCount <= 0) {
            log(bot, `Trade ${index} has been used to its maximum limit`);
            villager.close();
            return false;
        }
        
        if (!hasResources(villager.slots, trade, actualCount)) {
            log(bot, `Don't have enough resources to execute trade ${index} ${actualCount} time(s)`);
            villager.close();
            return false;
        }
        
        log(bot, `Executing trade ${index} ${actualCount} time(s)...`);
        
        try {
            await bot.trade(villager, tradeIndex, actualCount);
            log(bot, `Successfully traded ${actualCount} time(s)`);
            villager.close();
            return true;
        } catch (tradeErr) {
            log(bot, 'An error occurred while trying to execute the trade');
            console.log('Trade execution error:', tradeErr.message);
            villager.close();
            return false;
        }
    } catch (err) {
        // [mindaxis-patch:villager-trade-error-msg]
        log(bot, `Failed to open villager trading: ${err.message}. Check villager has a profession (place job site blocks), and try during daytime.`);
        console.log('Villager interface error:', err.message);
        return false;
    }
}

function hasResources(window, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
        let c = 0;
        window.forEach((element) => {
            if (element && element.type === item.type && element.metadata === item.metadata) {
                c += element.count;
            }
        });
        return c >= item.count * count;
    }
}

function stringifyTrades(bot, trades) {
    return trades.map((trade) => {
        let text = stringifyItem(bot, trade.inputItem1);
        if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
        if (trade.disabled) text += ' x '; else text += ' » ';
        text += stringifyItem(bot, trade.outputItem);
        return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
    });
}

function stringifyItem(bot, item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
        const ench = item.nbt.value.ench;
        const StoredEnchantments = item.nbt.value.StoredEnchantments;
        const Potion = item.nbt.value.Potion;
        const display = item.nbt.value.display;

        if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
        if (display) text += ` named ${display.value.Name.value}`;
        if (ench || StoredEnchantments) {
            text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                const lvl = e.lvl.value;
                const id = e.id.value;
                return bot.registry.enchantments[id].displayName + ' ' + lvl;
            }).join(' ')}`;
        }
    }
    return text;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    let start_block_pos = bot.blockAt(bot.entity.position).position;
    for (let i = 1; i <= distance; i++) {
        const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
        let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

        if (!targetBlock || !belowBlock) {
            log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
            return true;
        }

        // Check for lava, water
        if (targetBlock.name === 'lava' || targetBlock.name === 'water' || 
            belowBlock.name === 'lava' || belowBlock.name === 'water') {
            log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
            return false;
        }

        const MAX_FALL_BLOCKS = 2;
        let num_fall_blocks = 0;
        for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
            if (!belowBlock || (belowBlock.name !== 'air' && belowBlock.name !== 'cave_air')) {
                break;
            }
            num_fall_blocks++;
            belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
        }
        if (num_fall_blocks > MAX_FALL_BLOCKS) {
            log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
            return false;
        }

        if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') {
            log(bot, 'Skipping air block');
            console.log(targetBlock.position);
            continue;
        }

        let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
        if (!dug) {
            log(bot, 'Failed to dig block at position:' + targetBlock.position);
            return false;
        }
    }
    log(bot, `Dug down ${distance} blocks.`);
    return true;
}

export async function goToSurface(bot) {
    // [mindaxis-patch:gotosurface-pillar] v6: dig staircase upward + 水泳脱出 + 家ガード
    const pos = bot.entity.position;

    // 家の範囲内かつ家のフロアレベルにいる場合はピラージャンプ禁止 — ドアを使うべき
    // Y座標が家のフロアより低い場合（地下・水中）はピラージャンプを実行する [mindaxis-patch:gotosurface-near-house-y-check]
    const _hs = bot._houseStructure;
    if (_hs && _hs.bounds) {
        const b = _hs.bounds;
        const px = Math.floor(pos.x), pz = Math.floor(pos.z);
        const _houseFloorY = b.y || 70;
        const _nearHouseXZ = px >= b.x1 - 2 && px <= b.x2 + 2 && pz >= b.z1 - 2 && pz <= b.z2 + 2;
        const _atFloorLevel = pos.y >= _houseFloorY - 2; // フロアの2ブロック以内ならドア使用
        if (_nearHouseXZ && _atFloorLevel) {
            log(bot, '[goToSurface] Near house at floor level — skipping pillar jump (use door instead).');
            return false;
        }
        if (_nearHouseXZ && !_atFloorLevel) {
            log(bot, '[goToSurface] Below house (y=' + Math.floor(pos.y) + ' < floor=' + _houseFloorY + ') — pillar jump to escape.');
        }
    }

    let surfaceY = null;
    for (let y = 360; y > -64; y--) {
        const block = bot.blockAt(new Vec3(pos.x, y, pos.z));
        if (!block || block.name === 'air' || block.name === 'cave_air') continue;
        surfaceY = y + 1;
        break;
    }
    if (surfaceY === null) { log(bot, 'Could not find surface.'); return false; }
    // 水中判定
    const _feetB = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
    const _belowB = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z)));
    const _inWater = bot.entity.isInWater || (_feetB && (_feetB.name === 'water' || _feetB.name === 'flowing_water')) || (_belowB && (_belowB.name === 'water' || _belowB.name === 'flowing_water'));
    if (_inWater) {
        log(bot, 'In water (y=' + Math.floor(pos.y) + ', surface=' + surfaceY + '). Swimming to shore...');
        function findLand() {
            let cp = bot.entity.position;
            let best = null;
            let bestDist = 999;
            // [mindaxis-patch:findland-skip-house-walls] 家の壁を shore として誤認識しないようにする
            const _flHs = bot._houseStructure;
            const _flBounds = _flHs && _flHs.bounds;
            for (let dir of [{dx:1,dz:0,n:'east'},{dx:-1,dz:0,n:'west'},{dx:0,dz:1,n:'south'},{dx:0,dz:-1,n:'north'}]) {
                for (let dist = 1; dist <= 8; dist++) {
                    let cx = Math.floor(cp.x) + dir.dx * dist;
                    let cz = Math.floor(cp.z) + dir.dz * dist;
                    // 家の bounds 内の座標は shore 候補から除外（壁を shore と誤認識しない）
                    if (_flBounds && cx >= _flBounds.x1 && cx <= _flBounds.x2 && cz >= _flBounds.z1 && cz <= _flBounds.z2) continue;
                    for (let dy = -1; dy <= 3; dy++) {
                        let checkY = Math.floor(cp.y) + dy;
                        let block = bot.blockAt(new Vec3(cx, checkY, cz));
                        let above = bot.blockAt(new Vec3(cx, checkY + 1, cz));
                        if (block && block.name !== 'water' && block.name !== 'flowing_water'
                            && block.name !== 'air' && block.name !== 'cave_air'
                            && above && (above.name === 'air' || above.name === 'cave_air')) {
                            if (dist < bestDist) {
                                bestDist = dist;
                                best = { x: cx + 0.5, y: checkY + 1, z: cz + 0.5, dir: dir.n, dist: dist };
                            }
                        }
                    }
                }
            }
            return best;
        }
        // [mindaxis-patch:shore-swim-v9] 水中脱出: pathfinder優先 + 水路振動検出 + バックトラック
        bot._goToSurfaceActive = true;
        // --- Phase 1: pathfinder で岸に移動（水中でもA*が使える） ---
        {
            let _pfShore = null; let _pfBestScore = 999;
            const _pfCp = bot.entity.position;
            const _pfBx = Math.floor(_pfCp.x), _pfBz = Math.floor(_pfCp.z);
            for (let dx = -25; dx <= 25; dx++) {
                for (let dz = -25; dz <= 25; dz++) {
                    const dist = Math.abs(dx) + Math.abs(dz);
                    if (dist === 0 || dist > 25) continue;
                    const cx = _pfBx + dx, cz = _pfBz + dz;
                    for (let checkY = Math.floor(_pfCp.y) - 2; checkY <= Math.floor(_pfCp.y) + 5; checkY++) {
                        const block = bot.blockAt(new Vec3(cx, checkY, cz));
                        const above = bot.blockAt(new Vec3(cx, checkY + 1, cz));
                        const above2 = bot.blockAt(new Vec3(cx, checkY + 2, cz));
                        if (block && block.name !== 'water' && block.name !== 'flowing_water'
                            && block.name !== 'air' && block.name !== 'cave_air'
                            && above && (above.name === 'air' || above.name === 'cave_air')
                            && above2 && (above2.name === 'air' || above2.name === 'cave_air')) {
                            const heightDiff = Math.abs(checkY + 1 - Math.floor(_pfCp.y));
                            const score = heightDiff * 5 + dist;
                            if (score < _pfBestScore) {
                                _pfBestScore = score;
                                _pfShore = { x: cx, y: checkY + 1, z: cz };
                            }
                        }
                    }
                }
            }
            if (_pfShore) {
                console.log('[swim] Phase 1: pathfinder to shore (' + _pfShore.x + ',' + _pfShore.y + ',' + _pfShore.z + ')');
                try {
                    // [mindaxis-patch:shore-pf-near0] radius=0 で正確な陸地座標を指定（水中でgoal達成しない）
                    const _pfTimeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error('pf-timeout')), 30000));
                    const _pfMoves = new pf.Movements(bot);
                    bot.pathfinder.setMovements(_pfMoves);
                    const _pfGoal = new pf.goals.GoalNear(_pfShore.x, _pfShore.y, _pfShore.z, 0);
                    await Promise.race([bot.pathfinder.goto(_pfGoal), _pfTimeoutP]);
                    const _pfPos = bot.entity.position;
                    const _pfFeet = bot.blockAt(new Vec3(Math.floor(_pfPos.x), Math.floor(_pfPos.y), Math.floor(_pfPos.z)));
                    const _pfOnLand = !(_pfFeet && (_pfFeet.name === 'water' || _pfFeet.name === 'flowing_water'));
                    if (_pfOnLand) {
                        bot._goToSurfaceActive = false;
                        log(bot, 'Pathfinder navigated to shore at y=' + Math.floor(_pfPos.y));
                        let _skyOK = true;
                        for (let _scy = Math.floor(_pfPos.y) + 2; _scy <= Math.floor(_pfPos.y) + 10; _scy++) {
                            const _scb = bot.blockAt(new Vec3(Math.floor(_pfPos.x), _scy, Math.floor(_pfPos.z)));
                            if (_scb && _scb.name !== 'air' && _scb.name !== 'cave_air' && _scb.name !== 'water' && _scb.name !== 'flowing_water') { _skyOK = false; break; }
                        }
                        if (_skyOK) { log(bot, 'On surface (sky visible), done!'); return true; }
                    } else {
                        console.log('[swim] Pathfinder reached goal but still in water');
                    }
                } catch (e) {
                    try { bot.pathfinder.stop(); } catch(_) {}
                    console.log('[swim] Pathfinder failed: ' + (e.message || e));
                }
            } else {
                console.log('[swim] No shore found within 25 blocks for pathfinder');
            }
        } // end Phase 1
        // --- Phase 2: 手動 swim ループ（pathfinder 失敗時フォールバック） ---
        {
        const _blacklistedShores = [];
        let _lastSwimPos = bot.entity.position.clone();
        let _stuckCount = 0;
        const _posHistory = [];
        let _channelSwimDir = null;
        let _channelSwimTicks = 0;
        const _channelTriedDirs = [];
        // [mindaxis-patch:surface-timeout] 最大 25 attempt（約 50 秒）で諦める。moveAway の中で詰まらないように
        const _swimStart = Date.now();
        for (let attempt = 0; attempt < 25; attempt++) {
            if (bot.interrupt_code || Date.now() - _swimStart > 45000) { bot._goToSurfaceActive = false; bot.setControlState('forward', false); bot.setControlState('jump', false); bot.setControlState('sprint', false); return false; }
            let cp = bot.entity.position;
            let cf = bot.blockAt(new Vec3(Math.floor(cp.x), Math.floor(cp.y), Math.floor(cp.z)));
            let cb = bot.blockAt(new Vec3(Math.floor(cp.x), Math.floor(cp.y) - 1, Math.floor(cp.z)));
            let feetInWater = cf && (cf.name === 'water' || cf.name === 'flowing_water');
            let onSolid = cb && cb.name !== 'air' && cb.name !== 'cave_air' && cb.name !== 'water' && cb.name !== 'flowing_water';
            if (!feetInWater && onSolid) {
                bot.setControlState('forward', false); bot.setControlState('jump', false); bot.setControlState('sprint', false);
                log(bot, 'Escaped water at y=' + Math.floor(cp.y) + '! Standing on ' + cb.name);
                // Sky check: 上方10ブロックに固体がなければ地上 → 即リターン
                let _skyOK = true;
                for (let _scy = Math.floor(cp.y) + 2; _scy <= Math.floor(cp.y) + 10; _scy++) {
                    let _scb = bot.blockAt(new Vec3(Math.floor(cp.x), _scy, Math.floor(cp.z)));
                    if (_scb && _scb.name !== 'air' && _scb.name !== 'cave_air' && _scb.name !== 'water' && _scb.name !== 'flowing_water') {
                        _skyOK = false; break;
                    }
                }
                if (_skyOK) { log(bot, 'On surface (sky visible), done!'); return true; }
                break; // underground → dig-staircase
            }
            // 進捗チェック: 水平距離0.3ブロック以上動いたか
            const _movedDist = Math.sqrt((cp.x - _lastSwimPos.x) ** 2 + (cp.z - _lastSwimPos.z) ** 2);
            if (_movedDist < 0.3) { _stuckCount++; } else { _stuckCount = 0; _lastSwimPos = cp.clone(); }
            // デバッグログ（全回 console.log で切り詰め回避）
            console.log('[swim] #' + attempt + ' pos=(' + cp.x.toFixed(1) + ',' + cp.y.toFixed(1) + ',' + cp.z.toFixed(1) + ') moved=' + _movedDist.toFixed(2) + ' stuck=' + _stuckCount);
            // 振動検出: 6ティック前と同じ場所にいるか
            _posHistory.push({ x: cp.x, z: cp.z });
            let _oscillating = false;
            if (_posHistory.length >= 8) {
                const _oldP = _posHistory[_posHistory.length - 6];
                const _oscDist = Math.sqrt((cp.x - _oldP.x) ** 2 + (cp.z - _oldP.z) ** 2);
                if (_oscDist < 3.0) _oscillating = true;
            }
            // 水路追従: 振動を検出したら水が続く方向に泳ぐ
            if (_oscillating && attempt >= 6) {
                // [mindaxis-patch:swim-osc-dig-up] 振動検出時は水路追従前に即掘り上げ
                if (!_channelSwimDir) {
                    bot.setControlState('forward', false); bot.setControlState('sprint', false);
                    let _oscDugUp = false;
                    for (let _dy = 1; _dy <= 5; _dy++) {
                        const _dub = bot.blockAt(new Vec3(Math.floor(cp.x), Math.floor(cp.y) + _dy, Math.floor(cp.z)));
                        if (_dub && _dub.diggable && !['air','cave_air','water','flowing_water','bedrock'].includes(_dub.name)) {
                            try { await bot.dig(_dub); _oscDugUp = true; console.log('[swim] OscDig ' + _dub.name + ' y=' + (Math.floor(cp.y)+_dy)); } catch(e) {}
                            break;
                        }
                    }
                    if (_oscDugUp) {
                        _stuckCount = 0; _lastSwimPos = cp.clone(); bot.setControlState('jump', true);
                        await new Promise(r => setTimeout(r, 600));
                        continue;
                    }
                }
                // 掘れなかった => 水路追従（従来の処理）
                // 各方向の連続水ブロック数を計算
                let _bestChDir = null; let _bestChLen = 0; let _secondChDir = null; let _secondChLen = 0;
                for (const _chd of [{dx:1,dz:0,n:'E'},{dx:-1,dz:0,n:'W'},{dx:0,dz:1,n:'S'},{dx:0,dz:-1,n:'N'}]) {
                    let _wLen = 0;
                    for (let _d = 1; _d <= 20; _d++) {
                        const _wb = bot.blockAt(new Vec3(Math.floor(cp.x) + _chd.dx * _d, Math.floor(cp.y), Math.floor(cp.z) + _chd.dz * _d));
                        if (_wb && (_wb.name === 'water' || _wb.name === 'flowing_water')) _wLen++;
                        else break;
                    }
                    if (_wLen > _bestChLen) {
                        _secondChDir = _bestChDir; _secondChLen = _bestChLen;
                        _bestChLen = _wLen; _bestChDir = { dx: _chd.dx, dz: _chd.dz, n: _chd.n, len: _wLen };
                    } else if (_wLen > _secondChLen) {
                        _secondChLen = _wLen; _secondChDir = { dx: _chd.dx, dz: _chd.dz, n: _chd.n, len: _wLen };
                    }
                }
                if (_bestChDir && _bestChLen >= 3) {
                    // 現在の方向がまだ試されていないか、進捗があるか確認
                    if (!_channelSwimDir) {
                        // 試していない方向を選ぶ
                        const _alreadyTried = _channelTriedDirs.some(d => d.dx === _bestChDir.dx && d.dz === _bestChDir.dz);
                        if (_alreadyTried && _secondChDir && _secondChLen >= 3) {
                            _channelSwimDir = _secondChDir;
                        } else {
                            _channelSwimDir = _bestChDir;
                        }
                        _channelSwimTicks = 0;
                        console.log('[swim] Oscillation! Following waterway ' + _channelSwimDir.n + ' (water=' + _channelSwimDir.len + 'b)');
                    }
                    _channelSwimTicks++;
                    // 10ティック進んでも脱出できなければ方向転換
                    if (_channelSwimTicks > 10) {
                        console.log('[swim] Channel dir ' + _channelSwimDir.n + ' no progress after 10 ticks, trying opposite');
                        _channelTriedDirs.push({ dx: _channelSwimDir.dx, dz: _channelSwimDir.dz });
                        const _oppDir = { dx: -_channelSwimDir.dx, dz: -_channelSwimDir.dz, n: (_channelSwimDir.dx === 1 ? 'W' : _channelSwimDir.dx === -1 ? 'E' : _channelSwimDir.dz === 1 ? 'N' : 'S') };
                        const _oppTried = _channelTriedDirs.some(d => d.dx === _oppDir.dx && d.dz === _oppDir.dz);
                        if (!_oppTried) {
                            _channelSwimDir = _oppDir;
                            _channelSwimTicks = 0;
                            console.log('[swim] Backtracking: ' + _channelSwimDir.n);
                        } else {
                            console.log('[swim] Both channel dirs tried, falling through to pillar');
                            _channelSwimDir = null;
                            break;
                        }
                    }
                    await bot.lookAt(new Vec3(cp.x + _channelSwimDir.dx * 10, cp.y + 0.5, cp.z + _channelSwimDir.dz * 10));
                    bot.setControlState('forward', true); bot.setControlState('sprint', true);
                    bot.setControlState('jump', attempt % 3 === 0);
                    await new Promise(r => setTimeout(r, 1200));
                    continue;
                }
            } else if (!_oscillating) {
                // 振動が止まったらチャンネル追従リセット
                _channelSwimDir = null;
                _channelSwimTicks = 0;
            }
            // findLand: 全方位スキャン（15ブロック範囲）
            let land = null;
            let _localWaterTop = Math.floor(cp.y);
            {
                let _cp2 = bot.entity.position;
                let _best = null; let _bestScore = 999;
                let _bx = Math.floor(_cp2.x), _bz = Math.floor(_cp2.z);
                _localWaterTop = Math.floor(_cp2.y);
                for (let _wy = Math.floor(_cp2.y); _wy <= Math.floor(_cp2.y) + 20; _wy++) {
                    let _wb = bot.blockAt(new Vec3(_bx, _wy, _bz));
                    if (!_wb || (_wb.name !== 'water' && _wb.name !== 'flowing_water')) { _localWaterTop = _wy; break; }
                }
                let _yMin = Math.floor(_cp2.y) - 2;
                let _yMax = _localWaterTop + 4;
                if (attempt === 0) console.log('[swim] waterTop=' + _localWaterTop + ' searchY=' + _yMin + '-' + _yMax);
                for (let dx = -15; dx <= 15; dx++) {
                    for (let dz = -15; dz <= 15; dz++) {
                        let dist = Math.abs(dx) + Math.abs(dz);
                        if (dist === 0 || dist > 15) continue;
                        let cx = _bx + dx, cz = _bz + dz;
                        for (let checkY = _yMin; checkY <= _yMax; checkY++) {
                            let block = bot.blockAt(new Vec3(cx, checkY, cz));
                            let above = bot.blockAt(new Vec3(cx, checkY + 1, cz));
                            // [mindaxis-patch:shore-dry-only] 水没した壁を岸と誤認しないよう water を除外
                            let _aboveOk = above && (above.name === 'air' || above.name === 'cave_air');
                            if (block && block.name !== 'water' && block.name !== 'flowing_water'
                                && block.name !== 'air' && block.name !== 'cave_air'
                                && _aboveOk) {
                                let isBlacklisted = _blacklistedShores.some(bl => bl.x === cx && bl.z === cz && bl.y === checkY);
                                let heightDiff = Math.abs(checkY + 1 - _localWaterTop);
                                let score = heightDiff * 10 + dist;
                                if (!isBlacklisted && score < _bestScore) {
                                    _bestScore = score;
                                    let _dirName = (dx > 0 ? 'E' : dx < 0 ? 'W' : '') + (dz > 0 ? 'S' : dz < 0 ? 'N' : '');
                                    _best = { x: cx + 0.5, y: checkY + 1, z: cz + 0.5, dir: _dirName || 'here', dist: dist, bx: cx, bz: cz, by: checkY };
                                }
                            }
                        }
                    }
                }
                land = _best;
            }
            if (land) {
                console.log('[swim] Shore ' + land.dist + 'b ' + land.dir + ' y=' + land.by + ' stuck=' + _stuckCount + ' nearSurf=' + (cp.y >= _localWaterTop - 3));
                // stuck=4 → dig toward shore (cardinal directions)
                if (_stuckCount >= 4) {
                    console.log('[swim] Stuck ' + _stuckCount + ', digging toward shore...');
                    const _digDirX = Math.sign(land.x - cp.x);
                    const _digDirZ = Math.sign(land.z - cp.z);
                    let _dugSomething = false;
                    const _digDirs = [];
                    if (_digDirX !== 0) _digDirs.push({ dx: _digDirX, dz: 0 });
                    if (_digDirZ !== 0) _digDirs.push({ dx: 0, dz: _digDirZ });
                    for (const _ddir of _digDirs) {
                        for (let _dy = -1; _dy <= 2; _dy++) {
                            for (let _dd = 1; _dd <= 3; _dd++) {
                                const _bx2 = Math.floor(cp.x) + _ddir.dx * _dd;
                                const _bz2 = Math.floor(cp.z) + _ddir.dz * _dd;
                                const _digBlock = bot.blockAt(new Vec3(_bx2, Math.floor(cp.y) + _dy, _bz2));
                                if (_digBlock && _digBlock.diggable && _digBlock.name !== 'air' && _digBlock.name !== 'cave_air'
                                    && _digBlock.name !== 'water' && _digBlock.name !== 'flowing_water' && _digBlock.name !== 'bedrock') {
                                    try { await bot.dig(_digBlock); _dugSomething = true; console.log('[swim] Dug ' + _digBlock.name + ' at (' + _bx2 + ',' + (Math.floor(cp.y)+_dy) + ',' + _bz2 + ')'); } catch(e) {}
                                }
                            }
                        }
                    }
                    if (!_dugSomething) { _blacklistedShores.push({ x: land.bx, z: land.bz, y: land.by }); }
                    _stuckCount = 0; _lastSwimPos = cp.clone(); continue;
                }
                // stuck=8 → blacklist this shore
                if (_stuckCount >= 8) {
                    console.log('[swim] Giving up on shore ' + land.dir + ', blacklisting');
                    _blacklistedShores.push({ x: land.bx, z: land.bz, y: land.by });
                    _stuckCount = 0; _lastSwimPos = cp.clone(); continue;
                }
                // SWIM toward shore — close=slow, far=fast
                let _nearSurface = cp.y >= _localWaterTop - 3;
                if (!_nearSurface) {
                    await bot.lookAt(new Vec3(cp.x, cp.y + 10, cp.z));
                    bot.setControlState('forward', true); bot.setControlState('jump', true); bot.setControlState('sprint', true);
                    await new Promise(r => setTimeout(r, 1500));
                } else if (land.dist <= 3) {
                    // [mindaxis-patch:shore-direct-swim] 近距離岸は pathfinder 不要。直接 lookAt + forward + jump
                    await bot.lookAt(new Vec3(land.x, cp.y + 0.5, land.z));
                    bot.setControlState('forward', true); bot.setControlState('sprint', true);
                    bot.setControlState('jump', true);
                    await new Promise(r => setTimeout(r, land.dist <= 2 ? 800 : 600));
                } else {
                    // 遠距離: フルスピード
                    await bot.lookAt(new Vec3(land.x, cp.y + 0.5, land.z));
                    bot.setControlState('forward', true); bot.setControlState('sprint', true);
                    bot.setControlState('jump', attempt % 3 === 0);
                    await new Promise(r => setTimeout(r, 1200));
                }
            } else {
                // No shore → cliff search (cardinal directions, 12 blocks)
                let _cliff = null; let _cliffBestDist = 999;
                for (let _cDir of [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}]) {
                    for (let _cDist = 1; _cDist <= 12; _cDist++) {
                        let _cx = Math.floor(cp.x) + _cDir.dx * _cDist;
                        let _cz = Math.floor(cp.z) + _cDir.dz * _cDist;
                        let _bFeet = bot.blockAt(new Vec3(_cx, Math.floor(cp.y), _cz));
                        if (_bFeet && _bFeet.diggable && _bFeet.name !== 'water' && _bFeet.name !== 'flowing_water'
                            && _bFeet.name !== 'air' && _bFeet.name !== 'cave_air' && _bFeet.name !== 'bedrock') {
                            if (_cDist < _cliffBestDist) { _cliffBestDist = _cDist; _cliff = { x: _cx, z: _cz, y: Math.floor(cp.y), dist: _cDist }; }
                            break;
                        }
                    }
                }
                if (_cliff) {
                    console.log('[swim] No flat shore, cliff ' + _cliff.dist + 'b away');
                    await bot.lookAt(new Vec3(_cliff.x + 0.5, cp.y, _cliff.z + 0.5));
                    bot.setControlState('forward', true); bot.setControlState('sprint', true);
                    bot.setControlState('jump', attempt % 3 === 0);
                    await new Promise(r => setTimeout(r, 1500));
                    let _cp3 = bot.entity.position;
                    let _distC = Math.sqrt((_cp3.x - (_cliff.x + 0.5)) ** 2 + (_cp3.z - (_cliff.z + 0.5)) ** 2);
                    if (_distC < 3.0) {
                        for (let _dy = -1; _dy <= 1; _dy++) {
                            let _db = bot.blockAt(new Vec3(_cliff.x, _cliff.y + _dy, _cliff.z));
                            if (_db && _db.diggable && _db.name !== 'water' && _db.name !== 'flowing_water' && _db.name !== 'bedrock') {
                                try { await bot.dig(_db); console.log('[swim] Dug cliff ' + _db.name); } catch(e) {}
                            }
                        }
                    }
                } else {
                    // [mindaxis-patch:swim-enclosed-dig-up] 陸も崖もない密閉水域 => 真上を掘る
                    console.log('[swim] Enclosed water, digging up');
                    bot.setControlState('forward', false); bot.setControlState('sprint', false); bot.setControlState('jump', true);
                    let _encDugUp = false;
                    for (let _dy = 1; _dy <= 5; _dy++) {
                        const _dub = bot.blockAt(new Vec3(Math.floor(cp.x), Math.floor(cp.y) + _dy, Math.floor(cp.z)));
                        if (_dub && _dub.diggable && !['air','cave_air','water','flowing_water','bedrock'].includes(_dub.name)) {
                            try { await bot.dig(_dub); _encDugUp = true; console.log('[swim] EncDig up ' + _dub.name + ' at y=' + (Math.floor(cp.y)+_dy)); } catch(e) {}
                            break;
                        }
                    }
                    await new Promise(r => setTimeout(r, _encDugUp ? 500 : 1000));
                }
            }
            if (attempt >= 49) { console.log('[swim] 50 attempts, pillar fallthrough...'); break; }
        }
        } // end Phase 2
        bot._goToSurfaceActive = false;
        bot.setControlState('forward', false); bot.setControlState('jump', false); bot.setControlState('sprint', false);
        log(bot, 'Could not escape water after 30 attempts.');
        return false;
    }
    // 地上近く（非水中 or 水中フォールスルー）なら現在位置で再評価
    const _gsWfPos = bot.entity.position;
    const _gsWfFt = bot.blockAt(new Vec3(Math.floor(_gsWfPos.x), Math.floor(_gsWfPos.y), Math.floor(_gsWfPos.z)));
    const _gsWfBel = bot.blockAt(new Vec3(Math.floor(_gsWfPos.x), Math.floor(_gsWfPos.y)-1, Math.floor(_gsWfPos.z)));
    const _gsWfWater = (_gsWfFt && (_gsWfFt.name === 'water' || _gsWfFt.name === 'flowing_water')) ||
                       (_gsWfBel && (_gsWfBel.name === 'water' || _gsWfBel.name === 'flowing_water'));
    // [mindaxis-patch:gotosurface-nearsurface-nowater] 水中（1ブロック下が水でも）near surface でも early return しない
    if (_gsWfPos.y >= surfaceY - 2 && !_gsWfWater) {
        log(bot, 'Already near surface (y=' + Math.floor(_gsWfPos.y) + ', surface=' + surfaceY + ').');
        return true;
    }
    // [mindaxis-patch:gotosurface-cliff-break] 水面付近で崖ブロックを掘って脱出
    if (_gsWfWater && _gsWfPos.y >= surfaceY - 3) {
        log(bot, '[cliff-break] Trying to break cliff...');
        const _cbDirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
        for (const _d of _cbDirs) {
            // まず隣に壊せるブロックがあるか確認
            let _cbFirst = null;
            for (let _dy = 0; _dy <= 1; _dy++) {
                const _b = bot.blockAt(new Vec3(Math.floor(_gsWfPos.x)+_d.dx, Math.floor(_gsWfPos.y)+_dy, Math.floor(_gsWfPos.z)+_d.dz));
                if (_b && _b.diggable && _b.name !== 'air' && _b.name !== 'cave_air' &&
                    _b.name !== 'water' && _b.name !== 'flowing_water' &&
                    _b.name !== 'lava' && _b.name !== 'flowing_lava') { _cbFirst = {b:_b,dy:_dy}; break; }
            }
            if (!_cbFirst) continue;
            // この方向に最大4ブロック連続で掘りながら前進
            let _cbBroke = false;
            for (let _dist = 1; _dist <= 4; _dist++) {
                for (let _dy = 0; _dy <= 1; _dy++) {
                    const _cb = bot.blockAt(new Vec3(Math.floor(_gsWfPos.x)+_d.dx*_dist, Math.floor(_gsWfPos.y)+_dy, Math.floor(_gsWfPos.z)+_d.dz*_dist));
                    if (_cb && _cb.diggable && _cb.name !== 'air' && _cb.name !== 'cave_air' &&
                        _cb.name !== 'water' && _cb.name !== 'flowing_water' &&
                        _cb.name !== 'lava' && _cb.name !== 'flowing_lava') {
                        try { await bot.dig(_cb); _cbBroke = true; log(bot, '[cliff-break] Broke ' + _cb.name + ' dist=' + _dist); } catch(e) {}
                    }
                }
                // 掘った後スプリントで前進を試みる
                await bot.lookAt(new Vec3(_gsWfPos.x+_d.dx*(_dist+1), _gsWfPos.y+1, _gsWfPos.z+_d.dz*(_dist+1)));
                bot.setControlState('forward', true); bot.setControlState('jump', true); bot.setControlState('sprint', true);
                await new Promise(r => setTimeout(r, 600));
                bot.setControlState('forward', false); bot.setControlState('jump', false); bot.setControlState('sprint', false);
                const _cbFt = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)));
                const _cbBel = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y)-1, Math.floor(bot.entity.position.z)));
                const _cbStillWater = (_cbFt && (_cbFt.name === 'water'||_cbFt.name === 'flowing_water')) || (_cbBel && (_cbBel.name === 'water'||_cbBel.name === 'flowing_water'));
                if (!_cbStillWater) { log(bot, '[cliff-break] Escaped water!'); return true; }
            }
            if (_cbBroke) break; // この方向で掘ったが脱出できなかった→次の方向は試さない
        }
    }
    log(bot, 'Digging to surface from y=' + Math.floor(_gsWfPos.y) + ' to y=' + surfaceY + '...');

    function findPillarItem() {
        return bot.inventory.items().find(i => i.name === 'dirt')
            || bot.inventory.items().find(i => i.name === 'cobblestone')
            || bot.inventory.items().find(i => i.name === 'netherrack')
            || bot.inventory.items().find(i => i.name.includes('planks'))
            || bot.inventory.items().find(i => i.name.includes('stone') || i.name.includes('deepslate'));
    }

    const maxSteps = (surfaceY - Math.floor(pos.y)) + 10;

    for (let step = 0; step < maxSteps; step++) {
        if (bot.interrupt_code) { bot.setControlState('jump', false); return false; }
        let curPos = bot.entity.position;
        let curY = Math.floor(curPos.y);

        const _pilFt = bot.blockAt(new Vec3(Math.floor(curPos.x), Math.floor(curPos.y), Math.floor(curPos.z)));
        const _pilWater = _pilFt && (_pilFt.name === 'water' || _pilFt.name === 'flowing_water');
        // [mindaxis-patch:gotosurface-pillardig-nowater] 水中は reached-surface でも return しない
        if (curPos.y >= surfaceY - 1 && !_pilWater) {
            log(bot, 'Reached surface at y=' + Math.floor(curPos.y) + '!');
            bot.setControlState('jump', false);
            return true;
        }
        if (_pilWater && curPos.y >= surfaceY - 2) {
            // 水面付近 → ジャンプして step-up を試みる
            bot.setControlState('jump', true);
            bot.setControlState('sprint', true);
            await new Promise(r => setTimeout(r, 1000));
            bot.setControlState('jump', false);
            bot.setControlState('sprint', false);
            const _pilAfterFt = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)));
            if (_pilAfterFt && _pilAfterFt.name !== 'water' && _pilAfterFt.name !== 'flowing_water') {
                log(bot, 'Jumped out of water at y=' + Math.floor(bot.entity.position.y) + '!');
                return true;
            }
        }

        let cx = Math.floor(curPos.x);
        let cz = Math.floor(curPos.z);

        // Step 1: Dig everything above (2-4 blocks up)
        for (let dy = 1; dy <= 4; dy++) {
            let block = bot.blockAt(new Vec3(cx, curY + dy, cz));
            if (block && block.name !== 'air' && block.name !== 'cave_air'
                && block.name !== 'water' && block.name !== 'flowing_water'
                && block.name !== 'lava' && block.name !== 'flowing_lava'
                && block.name !== 'bedrock') {
                try { await bot.dig(block); } catch (e) {}
                if (bot.interrupt_code) { bot.setControlState('jump', false); return false; }
                await new Promise(r => setTimeout(r, 50));
            }
        }

        // Step 2: Place a block under feet
        let standBlock = null;
        for (let dy = 0; dy <= 5; dy++) {
            let b = bot.blockAt(new Vec3(cx, curY - 1 - dy, cz));
            if (b && b.name !== 'air' && b.name !== 'cave_air'
                && b.name !== 'water' && b.name !== 'flowing_water') {
                standBlock = b;
                break;
            }
        }

        if (!standBlock) {
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 500));
            bot.setControlState('jump', false);
            await new Promise(r => setTimeout(r, 300));
            continue;
        }

        let targetPlaceY = standBlock.position.y + 1;
        let blockAtTarget = bot.blockAt(new Vec3(cx, targetPlaceY, cz));

        // [mindaxis-patch:dig-up-water-pillar] 水中でも standBlock があればピラージャンプ、水ブロックへ設置も許可
        let _digFeet = bot.blockAt(new Vec3(cx, curY, cz));
        const _digInWater = _digFeet && (_digFeet.name === 'water' || _digFeet.name === 'flowing_water');
        if (_digInWater && !standBlock) {
            // 足場なし+水中 → ジャンプして次の iteration で再評価
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 600));
            bot.setControlState('jump', false);
            await new Promise(r => setTimeout(r, 200));
            continue;
        }

        if (blockAtTarget && (blockAtTarget.name === 'air' || blockAtTarget.name === 'cave_air'
                || blockAtTarget.name === 'water' || blockAtTarget.name === 'flowing_water')
            && targetPlaceY >= curY) {
            let pillarItem = findPillarItem();
            if (!pillarItem) { log(bot, 'No blocks to build up.'); return false; }
            await bot.equip(pillarItem, 'hand');
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 300));
            try {
                await bot.lookAt(standBlock.position.offset(0.5, 1.0, 0.5));
                await bot.placeBlock(standBlock, new Vec3(0, 1, 0));
            } catch (e) {
                for (let dir of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
                    let sideBlock = bot.blockAt(new Vec3(cx + dir.x, curY, cz + dir.z));
                    if (sideBlock && sideBlock.name !== 'air' && sideBlock.name !== 'cave_air'
                        && sideBlock.name !== 'water' && sideBlock.name !== 'flowing_water') {
                        try {
                            let faceVec = new Vec3(-dir.x, 0, -dir.z);
                            await bot.lookAt(sideBlock.position.offset(0.5 - dir.x*0.5, 0.5, 0.5 - dir.z*0.5));
                            await bot.placeBlock(sideBlock, faceVec);
                            break;
                        } catch (e2) {}
                    }
                }
            }
            bot.setControlState('jump', false);
            await new Promise(r => setTimeout(r, 500));
        } else if (targetPlaceY < curY) {
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 500));
            bot.setControlState('jump', false);
            await new Promise(r => setTimeout(r, 300));
        } else {
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 500));
            bot.setControlState('jump', false);
            await new Promise(r => setTimeout(r, 300));
        }

        let newPos = bot.entity.position;
        if (Math.floor(newPos.y) <= curY && step > 5) {
            log(bot, '[dig-up] No progress at y=' + curY + ', trying lateral move');
            bot.setControlState('forward', true);
            await new Promise(r => setTimeout(r, 300));
            bot.setControlState('forward', false);
            await new Promise(r => setTimeout(r, 200));
        }
    }
    log(bot, 'Failed to reach surface.');
    return false;
}



export async function scanStructure(bot) {
    // [mindaxis-patch:scan-structure] レイキャスト方式で家の構造を検出
    const pos = bot.entity.position;
    let cx = Math.floor(pos.x);
    let cy = Math.floor(pos.y);
    let cz = Math.floor(pos.z);
    const MAX_RAY = 15;

    // house.json から _houseStructure を確実にロード
    if (!bot._houseStructure) {
        try {
            const _fs2 = await import('fs');
            const _hp2 = './bots/' + bot.username + '/house.json';
            if (_fs2.existsSync(_hp2)) {
                const _hd2 = JSON.parse(_fs2.readFileSync(_hp2, 'utf8'));
                if (_hd2 && _hd2.bounds) bot._houseStructure = _hd2;
            }
        } catch(_e) {}
    }

    // キャッシュされた家の bounds がある場合、レイキャストをスキップして直接使用
    // （ボット位置やボットが置いた内部ブロックで bounds がずれるのを防ぐ）
    const _cached = bot._houseStructure?.bounds;
    if (_cached) {
        const hFloorY = _cached.y ?? _cached.floorY ?? cy;
        const hDist = Math.max(
            Math.abs(cx - Math.floor((_cached.x1 + _cached.x2) / 2)),
            Math.abs(cz - Math.floor((_cached.z1 + _cached.z2) / 2))
        );
        if (hDist <= 15) {
            // house.json の bounds を信頼してレイキャスト結果を上書き
            cx = Math.floor((_cached.x1 + _cached.x2) / 2);
            cz = Math.floor((_cached.z1 + _cached.z2) / 2);
            cy = hFloorY;
        }
    }

    const IGNORE = new Set(['air', 'cave_air', 'water', 'flowing_water', 'torch',
        'wall_torch', 'redstone_torch', 'redstone_wall_torch', 'tall_grass',
        'short_grass', 'flower', 'poppy', 'dandelion', 'snow', 'snow_layer',
        'chest', 'trapped_chest', 'ender_chest', 'barrel',
        'furnace', 'blast_furnace', 'smoker',
        'crafting_table', 'enchanting_table', 'anvil',
        'brewing_stand', 'campfire', 'soul_campfire',
        'lantern', 'soul_lantern', 'flower_pot']);
    function isFurniture(name) {
        return name && (name.includes('_bed') || name.includes('banner') || name.includes('sign'));
    }

    function isDoor(name) { return name && name.includes('_door'); }
    // 自然ブロックを除外して偽陽性を防ぐ（洞窟や地形を家と誤検出しない）
    const NATURAL = new Set([
        'stone', 'deepslate', 'granite', 'diorite', 'andesite', 'tuff', 'calcite',
        'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium', 'mud', 'clay',
        'sand', 'red_sand', 'gravel',
        'netherrack', 'basalt', 'smooth_basalt', 'blackstone', 'bedrock',
        'ice', 'packed_ice', 'blue_ice', 'soul_sand', 'soul_soil'
    ]);
    function isWall(name) {
        if (!name || IGNORE.has(name) || isDoor(name)) return false;
        if (NATURAL.has(name)) return false;
        if (name.includes('_ore')) return false;
        if (name.includes('leaves')) return false;
        if (isFurniture(name)) return false;
        return true;
    }

    // 4方向にレイキャスト（足元Y+1 の高さで）
    const scanY = cy;  // 足元の高さ
    const dirs = [
        { name: 'north', dx: 0, dz: -1 },
        { name: 'south', dx: 0, dz: 1 },
        { name: 'west',  dx: -1, dz: 0 },
        { name: 'east',  dx: 1, dz: 0 }
    ];

    const walls = {};
    let doorInfo = null;
    let wallMaterial = null;

    for (const dir of dirs) {
        for (let dist = 1; dist <= MAX_RAY; dist++) {
            const bx = cx + dir.dx * dist;
            const bz = cz + dir.dz * dist;
            // 壁の高さ1-3を全部チェック
            for (let dy = 1; dy <= 3; dy++) {
                const block = bot.blockAt(new Vec3(bx, scanY + dy, bz));
                if (!block) continue;
                if (isDoor(block.name)) {
                    doorInfo = { x: bx, z: bz, facing: dir.name };
                    walls[dir.name] = dist;
                    break;
                }
                if (isWall(block.name)) {
                    walls[dir.name] = dist;
                    if (!wallMaterial) wallMaterial = block.name;
                    break;
                }
            }
            if (walls[dir.name]) break;
        }
    }

    // 4方向すべてで壁が見つかったか
    const enclosed = walls.north && walls.south && walls.west && walls.east;
    if (!enclosed) {
        // ギャップ検出: キャッシュ bounds または見つかった壁から推定
        const prevBounds = bot._houseStructure?.bounds;
        const wallsFound = Object.keys(walls);

        // 3方向以上の壁が見つかれば、欠けた方向を対面の距離からミラー推定
        let estimatedBounds = prevBounds;
        if (!estimatedBounds && wallsFound.length >= 3) {
            const eW = walls.west || walls.east || 5;
            const eE = walls.east || walls.west || 5;
            const eN = walls.north || walls.south || 5;
            const eS = walls.south || walls.north || 5;
            estimatedBounds = {
                x1: cx - eW, x2: cx + eE,
                z1: cz - eN, z2: cz + eS,
                y: scanY
            };
        }

        if (!estimatedBounds || wallsFound.length < 1) {
            return { enclosed: false, wallsFound, wallMaterial,
                description: 'Not inside an enclosed structure. Found walls: ' + (wallsFound.join(', ') || 'none') + '.' };
        }
        // 推定/キャッシュ境界で壁ラインをスキャンしてギャップを検出
        const gaps = [];
        const pb = estimatedBounds;
        const prevDoor = doorInfo || bot._houseStructure?.door;
        function isDoorPosEst(px, pz, dy) {
            return prevDoor && px === prevDoor.x && pz === prevDoor.z && dy <= 2;
        }
        for (let dy = 1; dy <= 3; dy++) {
            // 北壁 (z = pb.z1)
            for (let x = pb.x1; x <= pb.x2; x++) {
                if (isDoorPosEst(x, pb.z1, dy)) continue;
                const b = bot.blockAt(new Vec3(x, pb.y + dy, pb.z1));
                if (!b || b.name === 'air' || b.name === 'cave_air') {
                    gaps.push({ x, y: pb.y + dy, z: pb.z1, dir: 'north' });
                }
            }
            // 南壁 (z = pb.z2)
            for (let x = pb.x1; x <= pb.x2; x++) {
                if (isDoorPosEst(x, pb.z2, dy)) continue;
                const b = bot.blockAt(new Vec3(x, pb.y + dy, pb.z2));
                if (!b || b.name === 'air' || b.name === 'cave_air') {
                    gaps.push({ x, y: pb.y + dy, z: pb.z2, dir: 'south' });
                }
            }
            // 西壁 (x = pb.x1) — 角は北南で処理済みなので +1/-1
            for (let z = pb.z1 + 1; z < pb.z2; z++) {
                if (isDoorPosEst(pb.x1, z, dy)) continue;
                const b = bot.blockAt(new Vec3(pb.x1, pb.y + dy, z));
                if (!b || b.name === 'air' || b.name === 'cave_air') {
                    gaps.push({ x: pb.x1, y: pb.y + dy, z, dir: 'west' });
                }
            }
            // 東壁 (x = pb.x2)
            for (let z = pb.z1 + 1; z < pb.z2; z++) {
                if (isDoorPosEst(pb.x2, z, dy)) continue;
                const b = bot.blockAt(new Vec3(pb.x2, pb.y + dy, z));
                if (!b || b.name === 'air' || b.name === 'cave_air') {
                    gaps.push({ x: pb.x2, y: pb.y + dy, z, dir: 'east' });
                }
            }
        }
        const missingDirs = ['north','south','west','east'].filter(d => !walls[d]);
        let desc = 'House has ' + gaps.length + ' missing wall blocks.';
        desc += ' Found walls: ' + wallsFound.join(', ') + '.';
        desc += ' Damaged walls: ' + missingDirs.join(', ') + '.';
        if (wallMaterial) desc += ' Material: ' + wallMaterial + '.';
        return { enclosed: false, wallsFound, wallMaterial, gaps, previousBounds: estimatedBounds, bounds: estimatedBounds, description: desc };
    }

    // 境界座標を計算 — house.json の bounds がある場合はそちらを優先
    let x1, x2, z1, z2;
    if (_cached) {
        x1 = _cached.x1; x2 = _cached.x2; z1 = _cached.z1; z2 = _cached.z2;
    } else {
        x1 = cx - walls.west; x2 = cx + walls.east;
        z1 = cz - walls.north; z2 = cz + walls.south;
    }
    const width = x2 - x1 + 1;
    const depth = z2 - z1 + 1;

    // 屋根を検出 — house.json に roofY がある場合はそちらを優先
    let roofY = _cached?.roofY || null;
    if (!roofY) {
        for (let dy = 2; dy <= 10; dy++) {
            const block = bot.blockAt(new Vec3(cx, scanY + dy, cz));
            if (block && isWall(block.name)) {
                roofY = scanY + dy;
                break;
            }
        }
    }

    // 内部アイテムをスキャン（チェスト、ベッド、かまど等）
    const furniture = [];
    for (let x = x1 + 1; x < x2; x++) {
        for (let z = z1 + 1; z < z2; z++) {
            for (let dy = 1; dy <= 3; dy++) {
                const block = bot.blockAt(new Vec3(x, scanY + dy, z));
                if (!block) continue;
                if (block.name.includes('chest')) furniture.push('chest@' + x + ',' + (scanY+dy) + ',' + z);
                if (block.name.includes('bed')) furniture.push('bed@' + x + ',' + (scanY+dy) + ',' + z);
                if (block.name === 'furnace') furniture.push('furnace@' + x + ',' + (scanY+dy) + ',' + z);
                if (block.name === 'crafting_table') furniture.push('crafting_table@' + x + ',' + (scanY+dy) + ',' + z);
            }
        }
    }

    // enclosed でも壁と屋根のギャップを詳細スキャン
    const actualRoofY = roofY || (scanY + 4);
    const wallHeight = actualRoofY - scanY;
    const gaps = [];

    // ドア保護: 現在検出 or キャッシュから取得（ドアが壊れていても位置を保護）
    const doorRef = doorInfo || bot._houseStructure?.door;
    function isDoorPos(px, pz, dy) {
        return doorRef && px === doorRef.x && pz === doorRef.z && dy <= 2;
    }

    // 壁ギャップ: floor+1 から roof-1 まで全高さをチェック
    for (let dy = 1; dy < wallHeight; dy++) {
        // 北壁 (z = z1)
        for (let x = x1; x <= x2; x++) {
            if (isDoorPos(x, z1, dy)) continue;
            const b = bot.blockAt(new Vec3(x, scanY + dy, z1));
            if (!b || b.name === 'air' || b.name === 'cave_air') {
                gaps.push({ x, y: scanY + dy, z: z1, dir: 'north' });
            }
        }
        // 南壁 (z = z2)
        for (let x = x1; x <= x2; x++) {
            if (isDoorPos(x, z2, dy)) continue;
            const b = bot.blockAt(new Vec3(x, scanY + dy, z2));
            if (!b || b.name === 'air' || b.name === 'cave_air') {
                gaps.push({ x, y: scanY + dy, z: z2, dir: 'south' });
            }
        }
        // 西壁 (x = x1)
        for (let z = z1 + 1; z < z2; z++) {
            if (isDoorPos(x1, z, dy)) continue;
            const b = bot.blockAt(new Vec3(x1, scanY + dy, z));
            if (!b || b.name === 'air' || b.name === 'cave_air') {
                gaps.push({ x: x1, y: scanY + dy, z, dir: 'west' });
            }
        }
        // 東壁 (x = x2)
        for (let z = z1 + 1; z < z2; z++) {
            if (isDoorPos(x2, z, dy)) continue;
            const b = bot.blockAt(new Vec3(x2, scanY + dy, z));
            if (!b || b.name === 'air' || b.name === 'cave_air') {
                gaps.push({ x: x2, y: scanY + dy, z, dir: 'east' });
            }
        }
    }

    // 屋根ギャップ: roofY の高さで内部全域をチェック
    if (roofY) {
        for (let x = x1; x <= x2; x++) {
            for (let z = z1; z <= z2; z++) {
                const b = bot.blockAt(new Vec3(x, roofY, z));
                if (!b || b.name === 'air' || b.name === 'cave_air') {
                    gaps.push({ x, y: roofY, z, dir: 'roof' });
                }
            }
        }
    }

    const result = {
        enclosed: gaps.length === 0,
        bounds: { x1, z1, x2, z2, y: scanY, roofY: actualRoofY },
        interior: { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1 },
        door: doorInfo,
        wallMaterial: wallMaterial,
        size: width + 'x' + depth,
        furniture: furniture,
        gaps: gaps.length > 0 ? gaps : undefined
    };

    // [mindaxis-patch:cramped-detect] 狭小判定
    const interiorArea = (x2 - x1 - 1) * (z2 - z1 - 1);
    const freeTiles = interiorArea - furniture.length;
    const cramped = freeTiles <= 12 && furniture.length >= 2;
    result.cramped = cramped;
    result.interiorArea = interiorArea;

    // 人間が読める説明文を生成
    let desc = 'Inside a ' + width + 'x' + depth + ' ' + (wallMaterial || 'unknown') + ' house';
    desc += ' (x:' + x1 + '-' + x2 + ', z:' + z1 + '-' + z2 + ', floor y:' + scanY + ')';
    if (doorInfo) desc += '. Door: ' + doorInfo.facing + ' wall at (' + doorInfo.x + ',' + doorInfo.z + ')';
    if (gaps.length > 0) desc += '. DAMAGED: ' + gaps.length + ' gaps found (walls: ' + gaps.filter(g => g.dir !== 'roof').length + ', roof: ' + gaps.filter(g => g.dir === 'roof').length + ')';
    if (cramped) {
        const _expandDir = doorInfo ? (doorInfo.facing === 'west' ? 'east' : doorInfo.facing === 'east' ? 'west' : doorInfo.facing === 'north' ? 'south' : 'north') : 'east';
        desc += '. CRAMPED: Only ' + interiorArea + ' interior blocks with ' + furniture.length + ' furniture. Expand with !expandHouse("' + _expandDir + '", 4)';
    }
    if (furniture.length > 0) desc += '. Furniture: ' + furniture.join(', ');
    desc += '. Interior space: x=' + (x1+1) + '-' + (x2-1) + ', z=' + (z1+1) + '-' + (z2-1);
    result.description = desc;

    return result;
}


export async function repairStructure(bot) {
    // [mindaxis-patch:repair-structure] 家の壁ギャップを検出して修復
    const Vec3 = (await import('vec3')).default;

    // house.json から _houseStructure を確実にロード（ドア位置保護用）
    if (!bot._houseStructure) {
        try {
            const _fs = await import('fs');
            const _hp = './bots/' + bot.username + '/house.json';
            if (_fs.existsSync(_hp)) {
                const _hd = JSON.parse(_fs.readFileSync(_hp, 'utf8'));
                if (_hd && _hd.bounds) bot._houseStructure = _hd;
            }
        } catch(_e) {}
    }

    // 1. スキャンしてギャップを検出
    const scan = await scanStructure(bot);
    if (scan.enclosed) {
        log(bot, 'House is intact! No repairs needed.');
        return scan;
    }
    if (!scan.gaps || scan.gaps.length === 0) {
        log(bot, 'Cannot detect specific gaps to repair. ' + scan.description);
        return scan;
    }

    // 2. 修復材料を決定
    let material = scan.wallMaterial;
    if (!material) material = bot._houseStructure?.wallMaterial;
    const _preferMats = ['oak_planks', 'cobblestone', 'spruce_planks', 'birch_planks', 'stone', 'dirt'];
    if (!material) {
        const inv = bot.inventory.items();
        for (const p of _preferMats) {
            if (inv.find(i => i.name === p)) { material = p; break; }
        }
    }

    // 3. インベントリの在庫チェック → 不足ならチェストから自動取得
    const _countMat = (m) => bot.inventory.items().filter(i => i.name === m).reduce((s, i) => s + i.count, 0);
    let available = material ? _countMat(material) : 0;
    const needed = scan.gaps.length;

    if (available < needed) {
        log(bot, 'Need ' + needed + ' blocks, have ' + available + '. Checking chests...');
        // チェストから材料を取得（material が決まっていない場合は候補順に試す）
        const _matsToTry = material ? [material, ..._preferMats.filter(m => m !== material)] : _preferMats;
        for (const _tryMat of _matsToTry) {
            try {
                const _before = _countMat(_tryMat);
                await takeFromChest(bot, _tryMat, needed - available);
                const _after = _countMat(_tryMat);
                if (_after > _before) {
                    material = _tryMat;
                    available = _after;
                    log(bot, 'Took ' + (_after - _before) + ' ' + _tryMat + ' from chest (total: ' + available + ')');
                    if (available >= needed) break;
                }
            } catch(_e) {}
        }
    }

    if (!material || available === 0) {
        log(bot, 'No repair material available! Place building materials in a nearby chest or collect them.');
        return scan;
    }
    const toRepair = Math.min(needed, available);

    // 4. 各ギャップにブロックを配置（ドア位置は保護）
    const doorPos = scan.door || bot._houseStructure?.door;
    let repaired = 0;
    bot._repairMode = true; // placeBlock の家ガードをバイパス
    for (let i = 0; i < toRepair; i++) {
        const gap = scan.gaps[i];
        try {
            // ドア位置には壁材を置かない（ドアを配置するか、スキップ）
            if (doorPos && gap.x === doorPos.x && gap.z === doorPos.z && (gap.y - (scan.bounds?.y || 0)) <= 2) {
                const hasDoor = bot.inventory.items().find(it => it.name.includes('_door'));
                if (hasDoor) {
                    await placeBlock(bot, hasDoor.name, gap.x, gap.y, gap.z);
                    repaired++;
                    log(bot, 'Placed door at ' + gap.x + ',' + gap.y + ',' + gap.z);
                }
                continue;
            }
            const block = bot.blockAt(new Vec3(gap.x, gap.y, gap.z));
            if (block && block.name !== 'air' && block.name !== 'cave_air') continue;
            // 既にドアがある場所には壁材を置かない
            if (block && block.name.includes('_door')) continue;
            await placeBlock(bot, material, gap.x, gap.y, gap.z);
            repaired++;
        } catch (e) {
            log(bot, 'Could not place at ' + gap.x + ',' + gap.y + ',' + gap.z + ': ' + e.message);
        }
    }
    bot._repairMode = false;
    log(bot, 'Repaired ' + repaired + '/' + scan.gaps.length + ' wall gaps with ' + material + '.');

    // 5. 再スキャンで確認
    const rescan = await scanStructure(bot);
    if (rescan.enclosed) {
        log(bot, 'House is now fully enclosed! ' + rescan.description);
    } else if (rescan.gaps && rescan.gaps.length > 0) {
        log(bot, 'Still ' + rescan.gaps.length + ' gaps remaining. May need more material or another !repairHouse.');
    }
    return rescan;
}
export async function useToolOn(bot, toolName, targetName) {
    /**
     * Equip a tool and use it on the nearest target.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {string} targetName - entity type, block type, or "nothing" for no target
     * @returns {Promise<boolean>} true if action succeeded
     */
    if (!bot.inventory.slots.find(slot => slot && slot.name === toolName) && !bot.game.gameMode === 'creative') {
        log(bot, `You do not have any ${toolName} to use.`);
        return false;
    }

    targetName = targetName.toLowerCase();
    if (targetName === 'nothing') {
        const equipped = await equip(bot, toolName);
        if (!equipped) {
            return false;
        }
        await bot.activateItem();
        log(bot, `Used ${toolName}.`);
    } else if (world.isEntityType(targetName)) {
        const entity = world.getNearestEntityWhere(bot, e => e.name === targetName, 64);
        if (!entity) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z);
        if (toolName === 'hand') {
            await bot.unequip('hand');
        }
        else {
            const equipped = await equip(bot, toolName);
            if (!equipped) return false;
        }
        await bot.useOn(entity);
        log(bot, `Used ${toolName} on ${targetName}.`);
    } else {
        let block = null;
        if (targetName === 'water' || targetName === 'lava') {
            // we want to get liquid source blocks, not flowing blocks
            // so search for blocks with metadata 0 (not flowing)
            let blocks = world.getNearestBlocksWhere(bot, block => block.name === targetName && block.metadata === 0, 64, 1);
            if (blocks.length === 0) {
                log(bot, `Could not find any source ${targetName}.`);
                return false;
            }
            block = blocks[0];
        }
        else {
            // [mindaxis-patch:hoe-surface-only] hoe で dirt/grass_block を使う場合、地上のブロックのみ対象
            if (toolName.includes('hoe') && (targetName === 'dirt' || targetName === 'grass_block')) {
                const _allBlocks = world.getNearestBlocksWhere(bot, b => b.name === targetName, 64, 20);
                block = null;
                for (const _b of _allBlocks) {
                    let _underground = false;
                    for (let _dy = 1; _dy <= 20; _dy++) {
                        const _cb = bot.blockAt(_b.position.offset(0, _dy, 0));
                        if (_cb && _cb.name !== 'air' && _cb.name !== 'cave_air' && _cb.name !== 'water' && _cb.name !== 'flowing_water') {
                            _underground = true; break;
                        }
                    }
                    if (!_underground) { block = _b; break; }
                }
                if (!block) {
                    log(bot, `Could not find any surface ${targetName} to till (only underground blocks found).`);
                    return false;
                }
            } else {
                block = world.getNearestBlock(bot, targetName, 64);
            }
        }
        if (!block) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        return await useToolOnBlock(bot, toolName, block);
    }

    return true;
 }

 export async function useToolOnBlock(bot, toolName, block) {
    /**
     * Use a tool on a specific block.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {Block} block - the block reference to use the tool on.
     * @returns {Promise<boolean>} true if action succeeded
     */

    const distance = toolName === 'water_bucket' && block.name !== 'lava' ? 1.5 : 2;
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, distance);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

    // if block in view is closer than the target block, it is in our way. try to move closer
    const viewBlocked = () => {
        const blockInView = bot.blockAtCursor(5);
        const headPos = bot.entity.position.offset(0, bot.entity.height, 0);
        return blockInView && 
            !blockInView.position.equals(block.position) && 
            blockInView.position.distanceTo(headPos) < block.position.distanceTo(headPos);
    }
    const blockInView = bot.blockAtCursor(5);
    if (viewBlocked()) {
        log(bot, `Block ${blockInView.name} is in the way, moving closer...`);
        // choose random block next to target block, go to it
        const nearbyPos = block.position.offset(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        await goToPosition(bot, nearbyPos.x, nearbyPos.y, nearbyPos.z, 1);
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        if (viewBlocked()) {
            const blockInView = bot.blockAtCursor(5);
            log(bot, `Block ${blockInView.name} is in the way, not using ${toolName}.`);
            return false;
        }
    }

    const equipped = await equip(bot, toolName);

    if (!equipped) {
        log(bot, `Could not equip ${toolName}.`);
        return false;
    }
    if (toolName.includes('bucket')) {
        await bot.activateItem();
    }
    else {
        await bot.activateBlock(block);
    }
    log(bot, `Used ${toolName} on ${block.name}.`);
    return true;
 }
