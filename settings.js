const settings = {
    "minecraft_version": "auto",
    "host": "127.0.0.1",
    "port": 25565,
    "auth": "offline",

    "mindserver_port": 8080,
    "auto_open_ui": true,

    "base_profile": "survival",
    "profiles": [
        "../profiles/6aac22de.mindcraft.json"
    ],

    "load_memory": true,
    "init_message": "Check your inventory with !inventory. If you have 30+ oak_log, use !newAction to build a house. Do NOT use !buildHouse. You are AUTONOMOUS - act without asking!",
    "only_chat_with": ["nera_07","satori_sz9","SlinkyCurve2157","aoo","CHIBIMUGI"],

    "speak": false,
    "chat_ingame": true,
    "language": "ja",
    "render_bot_view": false,

    "allow_insecure_coding": true,
    "allow_vision": false,
    "blocked_actions": [],
    "code_timeout_mins": 2,
    "relevant_docs_count": 5,

    "max_messages": -1,
    "num_examples": 2,
    "max_commands": -1,
    "show_command_syntax": "full",
    "narrate_behavior": true,
    "chat_bot_messages": false,

    "spawn_timeout": 30,
    "block_place_delay": 0,
    "log_all_prompts": false,
}

if (process.env.SETTINGS_JSON) {
    try {
        Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));
    } catch (err) {
        console.error("Failed to parse SETTINGS_JSON:", err);
    }
}

export default settings;
