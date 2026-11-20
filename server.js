const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Naruto Survivors Co-op Server (Terrain & Boss Cap Edition) Running!'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 3000;
const GIST_ID = process.env.GIST_ID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const rooms = new Map();

/**
 * ============================================================================
 * 【伺服器連線數值設定區】與前端 index.html 同步，可自行修改調整
 * ============================================================================
 */
const SERVER_BALANCE = {
    maxEnemies: 100,              // 【敵人上限】場上最多同時存在的敵人數量
    stopSpawnDuringBoss: true,    // 【BOSS 機制】true = BOSS 出現期間暫停生成普通小怪，直到擊敗 BOSS
    mudSpeedMultiplier: 0.45,     // 【泥地】移動速度倍率（0.45 = 45% 速度）
    poisonDamagePerSec: 18,       // 【毒氣區】每秒扣除的生命值
    scrollHealAmount: 35,         // 【書卷：查克拉爆發】立即回復的生命值
    hokageSageHealRatio: 0.05,    // 【七代火影鳴人】仙術自動回復最大血量的比例（5%）
    hokageSageHealInterval: 5.0   // 【七代火影鳴人】仙術自動回血間隔（秒）
};

const CHAR_CONFIG = {
    naruto:        { name: '漩渦鳴人',           maxHp: 100, speed: 225, regen: 0,   weapon: 'shuriken',        cooldown: 0.95, damage: 15, count: 1, pierce: 1, clones: 0 },
    naruto_hokage: { name: '漩渦鳴人：七代火影', maxHp: 150, speed: 255, regen: 2.0, weapon: 'rasenshuriken',   cooldown: 0.85, damage: 30, count: 8, pierce: 3, clones: 1 },
    kakashi:       { name: '旗木卡卡西',         maxHp: 115,  speed: 245, regen: 0,   weapon: 'kunai',           cooldown: 1.05, damage: 25, count: 1, pierce: 1, clones: 0 },
    jiraiya:       { name: '自來也',             maxHp: 130, speed: 200, regen: 0,   weapon: 'needle',          cooldown: 1.35, damage: 20, count: 3, pierce: 1, clones: 0 },
    sasuke:        { name: '宇智波佐助',         maxHp: 100, speed: 240, regen: 0,   weapon: 'chidori_senbon',  cooldown: 0.92, damage: 22, count: 1, pierce: 1, clones: 0 },
    sakura:        { name: '春野櫻',             maxHp: 100, speed: 215, regen: 0.5, weapon: 'cherry_kunai',    cooldown: 1.15, damage: 25, count: 1, pierce: 1, clones: 0 },
    shikamaru:     { name: '奈良鹿丸',           maxHp: 105, speed: 220, regen: 0,   weapon: 'trench_knife',    cooldown: 1.10, damage: 22, count: 1, pierce: 1, clones: 0 },
    minato:        { name: '波風水門',           maxHp: 135, speed: 265, regen: 0,   weapon: 'hiraishin_kunai', cooldown: 0.82, damage: 30, count: 2, pierce: 1, clones: 0 },
    tobirama:      { name: '千手扉間',           maxHp: 145, speed: 250, regen: 1.0, weapon: 'suidanha',        cooldown: 0.85, damage: 32, count: 1, pierce: 4, clones: 0 },
    hashirama:     { name: '千手柱間',           maxHp: 155, speed: 235, regen: 1.5, weapon: 'wood_root',       cooldown: 0.80, damage: 38, count: 2, pierce: 5, clones: 0 }
};

/**
 * ============================================================================
 * 地圖特殊地質演算法（與前端 index.html 完全一致，確保座標精準對應）
 * ============================================================================
 */
const TERRAIN_SECTOR_SIZE = 720;

function getSectorTerrain(sx, sy) {
    if (sx === 0 && sy === 0) return null;
    const h1 = Math.sin(sx * 127.1 + sy * 311.7) * 43758.5453;
    const r1 = h1 - Math.floor(h1);
    if (r1 > 0.56) return null;
    const h2 = Math.sin(sx * 269.5 + sy * 183.3) * 28461.7123;
    const r2 = h2 - Math.floor(h2);
    const h3 = Math.sin(sx * 419.2 + sy * 371.9) * 19283.3412;
    const r3 = h3 - Math.floor(h3);
    const kind = r1 < 0.31 ? 'mud' : 'poison';
    const x = sx * TERRAIN_SECTOR_SIZE + 180 + r2 * (TERRAIN_SECTOR_SIZE - 360);
    const y = sy * TERRAIN_SECTOR_SIZE + 180 + r3 * (TERRAIN_SECTOR_SIZE - 360);
    const r = kind === 'mud' ? (115 + r2 * 45) : (95 + r3 * 40);
    return { kind, x, y, r };
}

function getTerrainStatusAt(x, y) {
    const csx = Math.floor(x / TERRAIN_SECTOR_SIZE);
    const csy = Math.floor(y / TERRAIN_SECTOR_SIZE);
    let inMud = false, inPoison = false;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const t = getSectorTerrain(csx + dx, csy + dy);
            if (!t) continue;
            if (Math.hypot(x - t.x, y - t.y) <= t.r) {
                if (t.kind === 'mud') inMud = true;
                else if (t.kind === 'poison') inPoison = true;
            }
        }
    }
    return { inMud, inPoison };
}

/**
 * ============================================================================
 * 全服排行榜 GitHub Gist 讀寫
 * ============================================================================
 */
let globalLeaderboard = [];

async function fetchGistLeaderboard() {
    if (!GIST_ID) return globalLeaderboard;
    try {
        const headers = { 'User-Agent': 'Naruto-Survivors-Server', 'Accept': 'application/vnd.github+json' };
        if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
        const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers });
        if (!res.ok) return globalLeaderboard;
        const data = await res.json();
        const raw = data?.files?.['leaderboard.json']?.content;
        if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) globalLeaderboard = parsed; }
    } catch (e) { console.error('Gist read error:', e.message); }
    return globalLeaderboard;
}

async function recordGlobalScore(entry) {
    await fetchGistLeaderboard();
    if (!globalLeaderboard.some(x => x.entryId === entry.entryId)) globalLeaderboard.push(entry);
    globalLeaderboard.sort((a, b) => (b.time - a.time) || (b.kills - a.kills));
    globalLeaderboard = globalLeaderboard.slice(0, 10);
    if (GIST_ID && GITHUB_TOKEN) {
        try {
            await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                method: 'PATCH',
                headers: { 'User-Agent': 'Naruto-Survivors-Server', 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: { 'leaderboard.json': { content: JSON.stringify(globalLeaderboard, null, 2) } } })
            });
        } catch (e) { console.error('Gist write error:', e.message); }
    }
    io.emit('globalLeaderboardUpdate', globalLeaderboard);
    return globalLeaderboard;
}
fetchGistLeaderboard();

const UPGRADE_POOL = {
    naruto: [{ id: 'w_count', title: '多重手裏劍', desc: '手裏劍每次額外投擲 +1 枚' }, { id: 'w_dmg', title: '風遁・查克拉注入', desc: '手裏劍傷害提升 +12' }, { id: 'w_cd', title: '影分身結印加速', desc: '主武器冷卻縮短 20%' }, { id: 'rasengan', title: '螺旋丸領域', desc: '解鎖/擴大周身螺旋丸氣流' }, { id: 'clone', title: '多重影分身之術', desc: '召喚 1 名鳴人分身自動投擲（上限 2 名）' }, { id: 'hp', title: '九尾查克拉恢復', desc: '最大生命 +30 並回復 60 HP' }, { id: 'speed', title: '瞬身疾走', desc: '移動速度提升 15%' }, { id: 'magnet', title: '查克拉吸引', desc: '寶石拾取範圍擴大 50%' }],
    naruto_hokage: [{ id: 'w_count', title: '八方螺旋手裏劍擴散', desc: '每次額外增加 +2 個方向發射螺旋手裏劍' }, { id: 'w_dmg', title: '六道仙術・查克拉增幅', desc: '螺旋手裏劍穿透傷害提升 +20' }, { id: 'w_cd', title: '九喇嘛模式・神速結印', desc: '主武器冷卻縮短 22%' }, { id: 'rasengan', title: '仙法・超大玉螺旋丸', desc: '解鎖/擴大周身金色超大玉螺旋丸領域' }, { id: 'bijuu_bomb', title: '尾獸玉・連彈', desc: '解鎖/增加尾獸玉發射數量，引發大範圍爆破' }, { id: 'clone', title: '多重影分身・七代火影', desc: '召喚 1 名七代火影分身協同作戰（最多 4 個分身）' }, { id: 'hp', title: '九喇嘛仙人查克拉', desc: '最大生命 +50（仙術回血20%同步提升）並回復 100 HP' }, { id: 'speed', title: '六道神速瞬身', desc: '移動速度提升 15%' }],
    kakashi: [{ id: 'w_count', title: '暗部連射苦無', desc: '苦無每次額外發射 +1 把' }, { id: 'w_dmg', title: '雷切附魔苦無', desc: '苦無暴擊傷害提升 +15' }, { id: 'w_cd', title: '寫輪眼動態視力', desc: '主武器冷卻縮短 22%' }, { id: 'raikiri', title: '雷切・環繞雷球', desc: '解鎖/增加 +1 顆高壓雷球環繞護身' }, { id: 'lightning', title: '雷遁・連鎖紫電', desc: '解鎖/強化自動落雷連鎖彈跳' }, { id: 'hp', title: '上忍戰鬥體魄', desc: '最大生命 +25 並回復 50 HP' }, { id: 'speed', title: '雷遁神速', desc: '移動速度提升 15%' }, { id: 'magnet', title: '查克拉感知', desc: '寶石拾取範圍擴大 50%' }],
    jiraiya: [{ id: 'w_count', title: '亂獅子髮・千本擴散', desc: '千本散射數量額外 +2 根' }, { id: 'w_dmg', title: '仙法・鋼針硬化', desc: '千本針傷害提升 +10' }, { id: 'w_cd', title: '高速結印', desc: '主武器冷卻縮短 20%' }, { id: 'fireball', title: '火遁・大炎彈', desc: '解鎖/強化巨型火球範圍爆炸' }, { id: 'rasengan', title: '仙法・超大玉螺旋丸', desc: '解鎖/擴大周身仙術氣場' }, { id: 'hp', title: '妙木山仙人體質', desc: '最大生命 +40 並回復 80 HP' }, { id: 'speed', title: '蛤蟆跳躍步法', desc: '移動速度提升 15%' }, { id: 'magnet', title: '仙術自然感知', desc: '寶石拾取範圍擴大 50%' }],
    sasuke: [{ id: 'w_count', title: '千鳥千本齊射', desc: '千鳥千本每次額外發射 +1 根' }, { id: 'w_dmg', title: '草薙劍氣增幅', desc: '千鳥千本傷害提升 +14' }, { id: 'w_cd', title: '萬花筒動態洞察', desc: '主武器冷卻縮短 22%' }, { id: 'raikiri', title: '千鳥流・環繞雷刃', desc: '解鎖/增加 +1 道高壓雷刃環繞護身' }, { id: 'amaterasu', title: '天照・不滅黑炎', desc: '解鎖/強化黑炎爆發焚燒敵群' }, { id: 'hp', title: '咒印生命力', desc: '最大生命 +25 並回復 50 HP' }, { id: 'speed', title: '雷遁瞬步', desc: '移動速度提升 15%' }, { id: 'magnet', title: '寫輪眼瞳力', desc: '寶石拾取範圍擴大 50%' }],
    sakura: [{ id: 'w_count', title: '連環櫻花苦無', desc: '櫻花苦無每次額外投擲 +1 把' }, { id: 'w_dmg', title: '怪力查克拉集中', desc: '苦無與體術傷害提升 +16' }, { id: 'w_cd', title: '醫療忍者精準控制', desc: '主武器冷卻縮短 20%' }, { id: 'cherry_smash', title: '櫻花衝・怪力震擊', desc: '解鎖/擴大地面震擊波震飛敵人' }, { id: 'byakugou', title: '百豪之印・掌仙術', desc: '解鎖/強化週期性治療光環' }, { id: 'hp', title: '百豪查克拉儲備', desc: '最大生命 +40 並回復 80 HP' }, { id: 'speed', title: '體術迴避步法', desc: '移動速度提升 15%' }, { id: 'magnet', title: '精細查克拉感知', desc: '寶石拾取範圍擴大 50%' }],
    shikamaru: [{ id: 'w_count', title: '飛燕・雙重查克拉刀', desc: '查克拉刀每次額外投擲 +1 把' }, { id: 'w_dmg', title: '阿斯瑪之刃銳化', desc: '查克拉刀傷害提升 +13' }, { id: 'w_cd', title: '兩百智商戰術連攜', desc: '主武器冷卻縮短 22%' }, { id: 'shadow_bind', title: '影子模仿術・領域', desc: '解鎖/擴大黑影領域（70% 強力減速）' }, { id: 'shadow_stitch', title: '影子縫合術', desc: '解鎖/增加黑影尖刺貫穿多名敵人' }, { id: 'hp', title: '中忍戰術防護', desc: '最大生命 +30 並回復 60 HP' }, { id: 'speed', title: '戰術撤離步法', desc: '移動速度提升 15%' }, { id: 'magnet', title: '戰場全局掌控', desc: '寶石拾取範圍擴大 60%' }],
    minato: [{ id: 'w_count', title: '飛雷神苦無陣', desc: '每次額外投擲 +1 把三叉飛雷神苦無' }, { id: 'w_dmg', title: '九尾陰之力灌注', desc: '飛雷神苦無傷害提升 +15' }, { id: 'w_cd', title: '黃色閃光神速', desc: '主武器冷卻縮短 24%' }, { id: 'hiraishin', title: '飛雷神・二段閃光斬', desc: '解鎖/強化金色閃電瞬殺多名敵人' }, { id: 'rasengan', title: '螺旋丸・閃光領域', desc: '解鎖/擴大高速旋轉螺旋丸氣流' }, { id: 'hp', title: '四代目火影護佑', desc: '最大生命 +30 並回復 65 HP' }, { id: 'speed', title: '時空間神速', desc: '移動速度提升 15%' }, { id: 'magnet', title: '飛雷神印記回收', desc: '寶石拾取範圍擴大 60%' }],
    tobirama: [{ id: 'w_count', title: '多重水斷波齊射', desc: '水斷波每次額外發射 +1 道高壓水刃' }, { id: 'w_dmg', title: '水遁・極限水壓', desc: '水斷波穿透傷害提升 +18' }, { id: 'w_cd', title: '單手結印・水遁神速', desc: '主武器冷卻縮短 22%' }, { id: 'water_dragon', title: '水遁・水龍彈之術', desc: '解鎖/增加巨型水龍彈範圍水爆' }, { id: 'tandem_bombs', title: '互乘起爆符', desc: '解鎖/強化起爆符連鎖引爆' }, { id: 'hp', title: '千手一族查克拉量', desc: '最大生命 +40 並回復 80 HP' }, { id: 'speed', title: '飛雷神瞬身步', desc: '移動速度提升 15%' }, { id: 'magnet', title: '感知水脈', desc: '寶石拾取範圍擴大 60%' }],
    hashirama: [{ id: 'w_count', title: '樹界降誕・萬木叢生', desc: '木遁樹根每次額外突刺 +1 條' }, { id: 'w_dmg', title: '仙法・神樹硬化', desc: '木遁樹根貫穿傷害提升 +22' }, { id: 'w_cd', title: '仙人模式查克拉循環', desc: '主武器冷卻縮短 24%' }, { id: 'wood_dragon', title: '木遁・木龍之術', desc: '解鎖/增加巨型木龍環繞碾壓並吸血' }, { id: 'senpo_buddha', title: '仙法木遁・真數千手', desc: '解鎖/強化金色千手巨掌轟炸全場' }, { id: 'hp', title: '柱間細胞・超再生', desc: '最大生命 +60 並回復 120 HP' }, { id: 'speed', title: '忍者之神疾行', desc: '移動速度提升 15%' }, { id: 'magnet', title: '森羅萬象感知', desc: '寶石拾取範圍擴大 70%' }]
};

function generateRoomCode() {
    let code; do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms.has(code)); return code;
}

function createPlayerState(id, name, slotIndex, charId = 'naruto') {
    const cfg = CHAR_CONFIG[charId] || CHAR_CONFIG.naruto;
    const pos = [{ x: 0, y: 0 }, { x: -65, y: 45 }, { x: 65, y: 45 }][slotIndex] || { x: 0, y: 0 };
    return {
        id, name: name || `忍者 ${slotIndex + 1}`, slot: slotIndex, charId,
        x: pos.x, y: pos.y, dx: 0, dy: 0, vx: 0, vy: 0, radius: 20, facing: 'right',
        hp: cfg.maxHp, maxHp: cfg.maxHp, speed: cfg.speed, regen: cfg.regen || 0,
        pickupRange: 130, hitTimer: 0, downed: false, reviveProgress: 0, kills: 0, pendingUpgrade: false,
        magnetTimer: 0, scrollTimer: 0, scrollType: '',
        sageHealTimer: SERVER_BALANCE.hokageSageHealInterval, poisonTick: 0,
        weapon: { type: cfg.weapon, cooldown: cfg.cooldown, timer: 0.3, damage: cfg.damage, count: cfg.count, pierce: cfg.pierce || 1 },
        skills: {
            rasengan: { level: 0, radius: 120, damage: 13, timer: 0, cooldown: 0.9 },
            bijuuBomb: { level: 0, count: 1, damage: 58, radius: 105, timer: 0, cooldown: 1.75 },
            raikiri: { level: 0, count: 2, damage: 18, radius: 95, speed: 3.4 },
            lightning: { level: 0, bolts: 2, damage: 26, timer: 0, cooldown: 1.7 },
            fireball: { level: 0, damage: 34, radius: 85, timer: 0, cooldown: 1.8 },
            amaterasu: { level: 0, count: 2, damage: 28, radius: 68, timer: 0, cooldown: 1.6 },
            cherrySmash: { level: 0, radius: 135, damage: 32, timer: 0, cooldown: 1.75 },
            byakugou: { level: 0, heal: 14, radius: 185, timer: 0, cooldown: 3.5 },
            shadowBind: { level: 0, radius: 135, damage: 11, timer: 0, cooldown: 0.85 },
            shadowStitch: { level: 0, spikes: 3, damage: 25, timer: 0, cooldown: 1.55 },
            hiraishin: { level: 0, strikes: 3, damage: 30, timer: 0, cooldown: 1.35 },
            waterDragon: { level: 0, count: 1, damage: 42, radius: 85, timer: 0, cooldown: 1.65 },
            tandemBombs: { level: 0, count: 3, damage: 36, radius: 75, timer: 0, cooldown: 1.55 },
            woodDragon: { level: 0, count: 2, damage: 32, radius: 115, speed: 3.2 },
            senpoBuddha: { level: 0, radius: 220, damage: 55, timer: 0, cooldown: 1.8 },
            clones: cfg.clones || 0, cloneTimers: [0.3, 0.5, 0.7, 0.9]
        }
    };
}

function broadcastLobby(room) {
    const players = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, slot: p.slot, charId: p.charId }));
    io.to(room.code).emit('lobbyUpdate', { code: room.code, hostId: room.hostId, players });
}

function startRoomGame(room) {
    room.state = 'PLAYING'; room.pausedBy = null; room.gameTime = 0;
    room.teamLevel = 1; room.teamXp = 0; room.teamXpNext = 30; room.totalKills = 0;
    room.spawnTimer = 0.5; room.propSpawnTimer = 2.5; room.nextEntityId = 1;
    room.enemies = []; room.props = []; room.items = []; room.projectiles = []; room.enemyProjectiles = []; room.hazards = []; room.gems = [];
    room.bossSpawned = { gaara: false, orochimaru: false, itachi: false, pain: false };
    let idx = 0;
    for (const [id, p] of room.players.entries()) room.players.set(id, createPlayerState(id, p.name, idx++, p.charId));
    io.to(room.code).emit('gameStarted');
}

function triggerTeamLevelUp(room) {
    room.state = 'LEVELUP'; room.teamXp -= room.teamXpNext; room.teamLevel++; room.teamXpNext = Math.floor(room.teamXpNext * 1.45);
    for (const p of room.players.values()) {
        p.pendingUpgrade = true;
        const maxC = p.charId === 'naruto_hokage' ? 4 : 2;
        const pool = (UPGRADE_POOL[p.charId] || UPGRADE_POOL.naruto).filter(u => !(u.id === 'clone' && p.skills.clones >= maxC));
        pool.sort(() => 0.5 - Math.random());
        io.to(p.id).emit('levelUpChoices', { level: room.teamLevel, choices: pool.slice(0, 3) });
    }
    emitUpgradeStatus(room);
}

function emitUpgradeStatus(room) {
    const waiting = Array.from(room.players.values()).filter(p => p.pendingUpgrade).length;
    io.to(room.code).emit('upgradeStatus', { waiting, total: room.players.size });
    if (waiting === 0 && room.state === 'LEVELUP') {
        if (room.teamXp >= room.teamXpNext) triggerTeamLevelUp(room);
        else { room.state = 'PLAYING'; io.to(room.code).emit('resumeGame'); }
    }
}

function applyPlayerUpgrade(p, id) {
    const maxC = p.charId === 'naruto_hokage' ? 4 : 2;
    if (id === 'w_count') p.weapon.count += (p.charId === 'jiraiya' || p.charId === 'naruto_hokage' ? 2 : 1);
    else if (id === 'w_dmg') p.weapon.damage += (p.charId === 'hashirama' ? 22 : p.charId === 'naruto_hokage' ? 20 : p.charId === 'tobirama' ? 18 : 14);
    else if (id === 'w_cd') p.weapon.cooldown *= 0.79;
    else if (id === 'rasengan') { p.skills.rasengan.level++; p.skills.rasengan.radius += 22; p.skills.rasengan.damage += 7; }
    else if (id === 'bijuu_bomb') { if (!p.skills.bijuuBomb.level) p.skills.bijuuBomb.level = 1; else { p.skills.bijuuBomb.level++; p.skills.bijuuBomb.count++; p.skills.bijuuBomb.damage += 22; p.skills.bijuuBomb.radius += 15; } }
    else if (id === 'raikiri') { if (!p.skills.raikiri.level) p.skills.raikiri.level = 1; else { p.skills.raikiri.level++; p.skills.raikiri.count++; p.skills.raikiri.damage += 8; } }
    else if (id === 'lightning') { if (!p.skills.lightning.level) p.skills.lightning.level = 1; else { p.skills.lightning.level++; p.skills.lightning.bolts++; p.skills.lightning.damage += 10; } }
    else if (id === 'fireball') { if (!p.skills.fireball.level) p.skills.fireball.level = 1; else { p.skills.fireball.level++; p.skills.fireball.damage += 16; p.skills.fireball.radius += 18; } }
    else if (id === 'amaterasu') { if (!p.skills.amaterasu.level) p.skills.amaterasu.level = 1; else { p.skills.amaterasu.level++; p.skills.amaterasu.count++; p.skills.amaterasu.damage += 12; p.skills.amaterasu.radius += 12; } }
    else if (id === 'cherry_smash') { if (!p.skills.cherrySmash.level) p.skills.cherrySmash.level = 1; else { p.skills.cherrySmash.level++; p.skills.cherrySmash.damage += 15; p.skills.cherrySmash.radius += 22; } }
    else if (id === 'byakugou') { if (!p.skills.byakugou.level) p.skills.byakugou.level = 1; else { p.skills.byakugou.level++; p.skills.byakugou.heal += 8; p.skills.byakugou.radius += 25; } }
    else if (id === 'shadow_bind') { if (!p.skills.shadowBind.level) p.skills.shadowBind.level = 1; else { p.skills.shadowBind.level++; p.skills.shadowBind.radius += 24; p.skills.shadowBind.damage += 6; } }
    else if (id === 'shadow_stitch') { if (!p.skills.shadowStitch.level) p.skills.shadowStitch.level = 1; else { p.skills.shadowStitch.level++; p.skills.shadowStitch.spikes++; p.skills.shadowStitch.damage += 10; } }
    else if (id === 'hiraishin') { if (!p.skills.hiraishin.level) p.skills.hiraishin.level = 1; else { p.skills.hiraishin.level++; p.skills.hiraishin.strikes++; p.skills.hiraishin.damage += 12; } }
    else if (id === 'water_dragon') { if (!p.skills.waterDragon.level) p.skills.waterDragon.level = 1; else { p.skills.waterDragon.level++; p.skills.waterDragon.count++; p.skills.waterDragon.damage += 18; } }
    else if (id === 'tandem_bombs') { if (!p.skills.tandemBombs.level) p.skills.tandemBombs.level = 1; else { p.skills.tandemBombs.level++; p.skills.tandemBombs.count++; p.skills.tandemBombs.damage += 15; } }
    else if (id === 'wood_dragon') { if (!p.skills.woodDragon.level) p.skills.woodDragon.level = 1; else { p.skills.woodDragon.level++; p.skills.woodDragon.count++; p.skills.woodDragon.damage += 14; p.skills.woodDragon.radius += 12; } }
    else if (id === 'senpo_buddha') { if (!p.skills.senpoBuddha.level) p.skills.senpoBuddha.level = 1; else { p.skills.senpoBuddha.level++; p.skills.senpoBuddha.radius += 35; p.skills.senpoBuddha.damage += 25; } }
    else if (id === 'clone' && p.skills.clones < maxC) p.skills.clones++;
    else if (id === 'hp') { p.maxHp += (p.charId === 'hashirama' ? 60 : p.charId === 'naruto_hokage' ? 50 : 35); p.hp = Math.min(p.maxHp, p.hp + 100); }
    else if (id === 'speed') p.speed *= 1.15;
    else if (id === 'magnet') p.pickupRange *= 1.5;
}

function hurtPlayer(room, p, amount, players, bypassIframes = false) {
    if (!p || p.downed) return;
    if (!bypassIframes && p.hitTimer > 0) return;
    p.hp = Math.max(0, p.hp - amount);
    if (!bypassIframes) { p.hitTimer = 0.55; io.to(p.id).emit('playerHurt'); }
    if (p.hp <= 0) {
        p.downed = true; p.reviveProgress = 0;
        if (players.length > 1) io.to(room.code).emit('fx', { type: 'downed', x: Math.round(p.x), y: Math.round(p.y), name: p.name });
    }
}

function damageEnemy(room, enemy, amount, attacker, color = '#fde047', knockbackForce = 70) {
    if (enemy.hp <= 0) return;
    enemy.hp -= amount; enemy.hitTimer = 0.11;
    io.to(room.code).emit('fx', { type: 'dmg', x: Math.round(enemy.x), y: Math.round(enemy.y - enemy.radius - 8), val: Math.floor(amount), color });
    if (attacker && knockbackForce > 0) {
        const angle = Math.atan2(enemy.y - attacker.y, enemy.x - attacker.x), kb = enemy.isBoss ? 0.08 : enemy.type === 'elite' ? 0.3 : 1.0;
        enemy.kbVx = Math.cos(angle) * knockbackForce * kb; enemy.kbVy = Math.sin(angle) * knockbackForce * kb;
    }
    if (enemy.hp <= 0) {
        room.totalKills++; if (attacker) attacker.kills++;
        room.gems.push({ id: room.nextEntityId++, x: enemy.x, y: enemy.y, value: enemy.xpValue });
        io.to(room.code).emit('fx', { type: 'poof', x: Math.round(enemy.x), y: Math.round(enemy.y) });
        if (enemy.isBoss) io.to(room.code).emit('bossAlert', { title: `★ 已擊敗強敵：${enemy.bossTitle}！ ★`, color: '#4ade80' });
    }
}

function damageProp(room, prop, dmg) {
    if (prop.hp <= 0) return;
    prop.hp -= dmg; prop.hitTimer = 0.12; io.to(room.code).emit('sfx', 'hit');
    if (prop.hp <= 0) {
        io.to(room.code).emit('fx', { type: 'prop_break', kind: prop.kind, x: prop.x, y: prop.y });
        const roll = Math.random();
        room.items.push({ id: room.nextEntityId++, kind: roll < 0.35 ? 'bomb_tag' : roll < 0.70 ? 'magnet' : 'scroll', x: prop.x, y: prop.y, life: 45 });
    }
}

function damagePropsInRadius(room, x, y, r, dmg) {
    for (const prp of room.props) if (prp.hp > 0 && Math.hypot(prp.x - x, prp.y - y) <= r + prp.radius) damageProp(room, prp, dmg);
}

function triggerItemPickup(room, p, item) {
    if (item.kind === 'bomb_tag') {
        const blastR = 560, blastDmg = 280 + Math.floor(room.gameTime * 0.8);
        io.to(room.code).emit('fx', { type: 'mega_bomb', x: Math.round(p.x), y: Math.round(p.y), r: blastR });
        io.to(room.code).emit('fx', { type: 'buff_text', x: Math.round(p.x), y: Math.round(p.y - 52), text: '🧨 起爆符・大爆破！', color: '#f97316' });
        for (const e of room.enemies) if (Math.hypot(e.x - p.x, e.y - p.y) <= blastR + e.radius) damageEnemy(room, e, blastDmg, p, '#fb923c', 260);
        damagePropsInRadius(room, p.x, p.y, blastR, 999);
    } else if (item.kind === 'magnet') {
        p.magnetTimer = 8.0; io.to(room.code).emit('sfx', 'levelup');
        io.to(room.code).emit('fx', { type: 'buff_text', x: Math.round(p.x), y: Math.round(p.y - 52), text: '🧲 萬象磁石 (8秒全吸)！', color: '#38bdf8' });
    } else if (item.kind === 'scroll') {
        p.scrollTimer = 10.0; const r = Math.random();
        if (r < 0.34) { p.scrollType = 'frenzy'; io.to(room.code).emit('fx', { type: 'buff_text', x: Math.round(p.x), y: Math.round(p.y - 52), text: '📜 秘卷：神速結印 (10秒)！', color: '#facc15' }); }
        else if (r < 0.68) { p.scrollType = 'power'; io.to(room.code).emit('fx', { type: 'buff_text', x: Math.round(p.x), y: Math.round(p.y - 52), text: '📜 秘卷：仙法增幅 (10秒)！', color: '#c084fc' }); }
        else {
            const healVal = SERVER_BALANCE.scrollHealAmount;
            p.scrollType = 'chakra'; p.hp = Math.min(p.maxHp, p.hp + healVal);
            io.to(room.code).emit('fx', { type: 'buff_text', x: Math.round(p.x), y: Math.round(p.y - 52), text: `📜 秘卷：查克拉爆發 (+${healVal}HP)！`, color: '#4ade80' });
        }
        io.to(room.code).emit('sfx', 'levelup');
    }
}

function checkAndSpawnTimedBosses(room, alivePlayers) {
    const mult = 1 + (room.players.size - 1) * 0.65, anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const spawnBoss = (key, title, st) => {
        room.bossSpawned[key] = true; const ang = Math.random() * Math.PI * 2;
        room.enemies.push({ id: room.nextEntityId++, type: key, isBoss: true, bossTitle: title, x: anchor.x + Math.cos(ang) * 520, y: anchor.y + Math.sin(ang) * 520, vx: 0, vy: 0, kbVx: 0, kbVy: 0, facing: 'left', hp: Math.round(st.hp * mult), maxHp: Math.round(st.hp * mult), speed: st.speed, damage: st.damage, radius: st.radius, xpValue: st.xp, hitTimer: 0, slowTimer: 0, slowFactor: 0.65, skillTimer1: 2.2, skillTimer2: 4.5, skillTimer3: 7.0, pullTimer: 0 });
        io.to(room.code).emit('bossAlert', { title: `⚠️ 強敵來襲：${title} 登場！`, color: st.alertColor }); io.to(room.code).emit('sfx', 'rasengan');
    };
    if (room.gameTime >= 180 && !room.bossSpawned.gaara) spawnBoss('gaara', '砂瀑之我愛羅', { hp: 9600, speed: 138, damage: 32, radius: 34, xp: 60, alertColor: '#f59e0b' });
    if (room.gameTime >= 300 && !room.bossSpawned.orochimaru) spawnBoss('orochimaru', '傳說三忍・大蛇丸', { hp: 12800, speed: 155, damage: 38, radius: 34, xp: 110, alertColor: '#a855f7' });
    if (room.gameTime >= 600 && !room.bossSpawned.itachi) spawnBoss('itachi', '曉・宇智波鼬', { hp: 15500, speed: 182, damage: 34, radius: 34, xp: 180, alertColor: '#ef4444' });
    if (room.gameTime >= 900 && !room.bossSpawned.pain) spawnBoss('pain', '神・佩恩（長門）', { hp: 18000, speed: 149, damage: 42, radius: 38, xp: 400, alertColor: '#c084fc' });
}

function updateBossSkills(room, boss, alivePlayers, dt) {
    if (!alivePlayers.length) return;
    boss.skillTimer1 -= dt; boss.skillTimer2 -= dt; boss.skillTimer3 -= dt;
    const pick = () => alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    if (boss.type === 'gaara') {
        if (boss.skillTimer1 <= 0) { boss.skillTimer1 = 3.2; const t = pick(), b = Math.atan2(t.y - boss.y, t.x - boss.x); for (let i = -3; i <= 3; i++) { const a = b + i * 0.16; room.enemyProjectiles.push({ id: room.nextEntityId++, kind: 'sand_bullet', x: boss.x, y: boss.y, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, angle: a, damage: 16, radius: 9, life: 2.6 }); } }
        if (boss.skillTimer2 <= 0) { boss.skillTimer2 = 5.2; for (const p of alivePlayers) room.hazards.push({ id: room.nextEntityId++, kind: 'sand_coffin', x: Math.round(p.x), y: Math.round(p.y), r: 82, delay: 1.15, maxDelay: 1.15, damage: 28 }); }
    } else if (boss.type === 'orochimaru') {
        if (boss.skillTimer1 <= 0) { boss.skillTimer1 = 2.8; const t = pick(), b = Math.atan2(t.y - boss.y, t.x - boss.x); for (let i = -2; i <= 2; i++) { const a = b + i * 0.2; room.enemyProjectiles.push({ id: room.nextEntityId++, kind: 'snake_fang', x: boss.x, y: boss.y, vx: Math.cos(a) * 410, vy: Math.sin(a) * 410, angle: a, damage: 22, radius: 10, life: 2.5 }); } }
        if (boss.skillTimer2 <= 0) { boss.skillTimer2 = 4.8; const t = pick(), a = Math.atan2(t.y - boss.y, t.x - boss.x); for (let st = 1; st <= 6; st++) room.hazards.push({ id: room.nextEntityId++, kind: 'kusanagi_line', x: Math.round(boss.x + Math.cos(a) * st * 75), y: Math.round(boss.y + Math.sin(a) * st * 75), r: 44, delay: 0.95, maxDelay: 0.95, damage: 32 }); }
    } else if (boss.type === 'itachi') {
        if (boss.skillTimer1 <= 0) { boss.skillTimer1 = 2.6; for (let i = 0; i < 10; i++) { const a = (Math.PI * 2 / 10) * i + room.gameTime; room.enemyProjectiles.push({ id: room.nextEntityId++, kind: 'fire_shuriken', x: boss.x, y: boss.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, angle: a, damage: 24, radius: 10, life: 2.6 }); } }
        if (boss.skillTimer2 <= 0) { boss.skillTimer2 = 4.4; for (const p of alivePlayers) room.hazards.push({ id: room.nextEntityId++, kind: 'amaterasu_trap', x: Math.round(p.x), y: Math.round(p.y), r: 76, delay: 1.0, maxDelay: 1.0, damage: 35 }); }
        if (boss.skillTimer3 <= 0) { boss.skillTimer3 = 6.5; const t = pick(); io.to(room.code).emit('fx', { type: 'crows', x: Math.round(boss.x), y: Math.round(boss.y) }); const a = Math.random() * Math.PI * 2; boss.x = t.x + Math.cos(a) * 210; boss.y = t.y + Math.sin(a) * 210; io.to(room.code).emit('fx', { type: 'crows', x: Math.round(boss.x), y: Math.round(boss.y) }); }
    } else if (boss.type === 'pain') {
        if (boss.pullTimer > 0) { boss.pullTimer -= dt; for (const p of alivePlayers) { const d = Math.hypot(boss.x - p.x, boss.y - p.y); if (d > 55 && d < 520) { const a = Math.atan2(boss.y - p.y, boss.x - p.x); p.x += Math.cos(a) * 145 * dt; p.y += Math.sin(a) * 145 * dt; } } }
        if (boss.skillTimer1 <= 0) { boss.skillTimer1 = 5.5; room.hazards.push({ id: room.nextEntityId++, kind: 'shinra_tensei', x: Math.round(boss.x), y: Math.round(boss.y), r: 230, delay: 1.15, maxDelay: 1.15, damage: 45, knockback: 420 }); }
        if (boss.skillTimer2 <= 0) { boss.skillTimer2 = 2.7; for (let i = 0; i < 12; i++) { const a = (Math.PI * 2 / 12) * i + room.gameTime * 0.7; room.enemyProjectiles.push({ id: room.nextEntityId++, kind: 'black_rod', x: boss.x, y: boss.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, angle: a, damage: 28, radius: 9, life: 2.8 }); } }
        if (boss.skillTimer3 <= 0) { boss.skillTimer3 = 7.5; boss.pullTimer = 1.3; io.to(room.code).emit('fx', { type: 'bansho', x: Math.round(boss.x), y: Math.round(boss.y) }); for (const p of alivePlayers) room.hazards.push({ id: room.nextEntityId++, kind: 'chibaku_tensei', x: Math.round(p.x), y: Math.round(p.y), r: 115, delay: 1.35, maxDelay: 1.35, damage: 42 }); }
    }
}

function stepRoom(room, dt) {
    if (room.state !== 'PLAYING') return;
    room.gameTime += dt;
    const players = Array.from(room.players.values());
    if (!players.length) return;
    const alivePlayers = players.filter(p => !p.downed);
    if (!alivePlayers.length) {
        room.state = 'GAMEOVER';
        const ranked = players.map(p => ({ id: p.id, name: p.name, charId: p.charId, kills: p.kills })).sort((a, b) => b.kills - a.kills);
        const entryId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, mvp = ranked[0];
        recordGlobalScore({ entryId, name: mvp ? mvp.name : '木葉忍者', charId: mvp ? mvp.charId : 'naruto', teamNames: ranked.map(p => p.name).join(' / '), modeLabel: ranked.length > 1 ? `${ranked.length}人合作` : '單機挑戰', time: Math.floor(room.gameTime), level: room.teamLevel, kills: room.totalKills }).then(lb => {
            io.to(room.code).emit('gameOver', { entryId, time: room.gameTime, level: room.teamLevel, totalKills: room.totalKills, players: ranked, globalLeaderboard: lb });
        });
        return;
    }

    checkAndSpawnTimedBosses(room, alivePlayers);

    room.propSpawnTimer -= dt;
    if (room.propSpawnTimer <= 0) {
        room.propSpawnTimer = 3.8;
        if (room.props.length < 12 && Math.random() < 0.42) {
            const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            const ang = Math.random() * Math.PI * 2, dist = 360 + Math.random() * 480;
            room.props.push({ id: room.nextEntityId++, kind: Math.random() < 0.5 ? 'rock' : 'wood', x: Math.round(anchor.x + Math.cos(ang) * dist), y: Math.round(anchor.y + Math.sin(ang) * dist), hp: 25, radius: 22, hitTimer: 0 });
        }
    }

    for (const p of players) {
        if (p.hitTimer > 0) p.hitTimer = Math.max(0, p.hitTimer - dt);
        if (p.magnetTimer > 0) p.magnetTimer = Math.max(0, p.magnetTimer - dt);
        if (p.scrollTimer > 0) p.scrollTimer = Math.max(0, p.scrollTimer - dt);

        if (p.downed) {
            p.vx = 0; p.vy = 0;
            if (alivePlayers.some(ally => Math.hypot(ally.x - p.x, ally.y - p.y) <= 68)) {
                p.reviveProgress += dt / 3.0;
                if (p.reviveProgress >= 1) { p.downed = false; p.reviveProgress = 0; p.hp = Math.round(p.maxHp * 0.5); p.hitTimer = 1.5; io.to(room.code).emit('fx', { type: 'revive', x: Math.round(p.x), y: Math.round(p.y), name: p.name }); }
            } else p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.35);
            continue;
        }

        // 七代火影：仙術形態定時自動回血 20%
        if (p.charId === 'naruto_hokage') {
            p.sageHealTimer -= dt;
            if (p.sageHealTimer <= 0) {
                p.sageHealTimer = SERVER_BALANCE.hokageSageHealInterval;
                const healAmt = Math.round(p.maxHp * SERVER_BALANCE.hokageSageHealRatio);
                p.hp = Math.min(p.maxHp, p.hp + healAmt);
                io.to(room.code).emit('fx', { type: 'sage_heal', x: Math.round(p.x), y: Math.round(p.y) });
                io.to(room.code).emit('fx', { type: 'dmg', x: Math.round(p.x), y: Math.round(p.y - 48), val: `+${healAmt}`, color: '#4ade80' });
            }
        }

        // 地圖特殊地質檢測（泥地減速、毒氣持續扣血）
        const terrain = getTerrainStatusAt(p.x, p.y);
        if (terrain.inPoison) {
            p.poisonTick += dt;
            if (p.poisonTick >= 0.5) {
                p.poisonTick -= 0.5;
                const pDmg = Math.max(1, Math.round(SERVER_BALANCE.poisonDamagePerSec * 0.5));
                io.to(room.code).emit('fx', { type: 'dmg', x: Math.round(p.x), y: Math.round(p.y - 36), val: `-${pDmg}`, color: '#a855f7' });
                hurtPlayer(room, p, pDmg, players, true);
                if (p.downed) continue;
            }
        } else {
            p.poisonTick = 0;
        }

        const dmgMult = p.scrollTimer > 0 ? (p.scrollType === 'power' ? 1.5 : 1.3) : 1.0;
        const cdMult = p.scrollTimer > 0 ? (p.scrollType === 'frenzy' ? 0.6 : 0.72) : 1.0;
        const scrollSpdMult = p.scrollTimer > 0 ? (p.scrollType === 'frenzy' ? 1.25 : 1.18) : 1.0;
        const terrainSpdMult = terrain.inMud ? SERVER_BALANCE.mudSpeedMultiplier : 1.0;
        p.effSpeed = p.speed * scrollSpdMult * terrainSpdMult;

        if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

        if (p.dx !== 0 || p.dy !== 0) {
            const len = Math.hypot(p.dx, p.dy), scale = len > 1 ? 1 / len : 1;
            p.vx = p.dx * scale * p.effSpeed; p.vy = p.dy * scale * p.effSpeed;
            p.x += p.vx * dt; p.y += p.vy * dt;
            if (p.dx < -0.05) p.facing = 'left'; if (p.dx > 0.05) p.facing = 'right';
        } else { p.vx = 0; p.vy = 0; }

        p.weapon.timer -= dt;
        if (p.weapon.timer <= 0 && (room.enemies.length > 0 || room.props.length > 0 || p.charId === 'naruto_hokage')) {
            let nearest = null, minDist = Infinity;
            for (const e of room.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < minDist) { minDist = d; nearest = e; } }
            if (!nearest) for (const prp of room.props) { const d = Math.hypot(prp.x - p.x, prp.y - p.y); if (d < 480 && d < minDist) { minDist = d; nearest = prp; } }

            if (p.charId === 'naruto_hokage') {
                const baseAngle = nearest ? Math.atan2(nearest.y - p.y, nearest.x - p.x) : 0;
                if (nearest) p.facing = Math.cos(baseAngle) >= 0 ? 'right' : 'left';
                const cnt = p.weapon.count;
                for (let i = 0; i < cnt; i++) {
                    const angle = baseAngle + ((Math.PI * 2) / cnt) * i;
                    room.projectiles.push({ id: room.nextEntityId++, ownerId: p.id, kind: 'rasenshuriken', x: p.x, y: p.y, vx: Math.cos(angle) * 780, vy: Math.sin(angle) * 780, angle, damage: Math.round(p.weapon.damage * dmgMult), pierce: p.weapon.pierce || 3, hitIds: new Set(), radius: 14, life: 1.5 });
                }
                io.to(room.code).emit('sfx', 'kunai'); p.weapon.timer = p.weapon.cooldown * cdMult;
            } else if (nearest && minDist < 840) {
                const baseAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x); p.facing = Math.cos(baseAngle) >= 0 ? 'right' : 'left';
                const cnt = p.weapon.count, spread = p.charId === 'jiraiya' ? 0.14 : 0.16, spd = p.charId === 'tobirama' ? 880 : p.charId === 'minato' ? 820 : 710;
                for (let i = 0; i < cnt; i++) {
                    const angle = baseAngle + (i - (cnt - 1) / 2) * spread;
                    room.projectiles.push({ id: room.nextEntityId++, ownerId: p.id, kind: p.weapon.type, x: p.x, y: p.y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, angle, damage: Math.round(p.weapon.damage * dmgMult), pierce: p.weapon.pierce || 1, hitIds: new Set(), radius: (p.weapon.type === 'suidanha' || p.weapon.type === 'wood_root') ? 13 : 10, life: 1.6 });
                }
                io.to(room.code).emit('sfx', 'kunai'); p.weapon.timer = p.weapon.cooldown * cdMult;
            }
        }

        if (p.skills.clones > 0 && room.enemies.length > 0) {
            const offsets = [[-52, -26], [52, -26], [-52, 26], [52, 26]];
            for (let c = 0; c < p.skills.clones; c++) {
                p.skills.cloneTimers[c] -= dt;
                if (p.skills.cloneTimers[c] <= 0) {
                    const [ox, oy] = offsets[c] || [-50, 0];
                    const cx = p.x + ox, cy = p.y + oy;
                    let nearest = null, minD = Infinity;
                    for (const e of room.enemies) { const d = Math.hypot(e.x - cx, e.y - cy); if (d < minD) { minD = d; nearest = e; } }
                    if (nearest && minD < 750) {
                        const ang = Math.atan2(nearest.y - cy, nearest.x - cx);
                        const isHokage = p.charId === 'naruto_hokage';
                        room.projectiles.push({ id: room.nextEntityId++, ownerId: p.id, kind: isHokage ? 'rasenshuriken' : 'shuriken', x: cx, y: cy, vx: Math.cos(ang) * 720, vy: Math.sin(ang) * 720, angle: ang, damage: Math.ceil(p.weapon.damage * (isHokage ? 0.75 : 0.65) * dmgMult), pierce: isHokage ? 2 : 1, hitIds: new Set(), radius: isHokage ? 12 : 9, life: 1.5 });
                    }
                    p.skills.cloneTimers[c] = p.weapon.cooldown * 1.15 * cdMult;
                }
            }
        }

        if (p.skills.bijuuBomb.level > 0 && room.enemies.length > 0) {
            p.skills.bijuuBomb.timer -= dt;
            if (p.skills.bijuuBomb.timer <= 0) {
                p.skills.bijuuBomb.timer = p.skills.bijuuBomb.cooldown * cdMult;
                const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 620).sort(() => 0.5 - Math.random()).slice(0, p.skills.bijuuBomb.count);
                if (ts.length) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const t of ts) {
                        const ang = Math.atan2(t.y - p.y, t.x - p.x);
                        room.projectiles.push({ id: room.nextEntityId++, ownerId: p.id, kind: 'bijuu_bomb', x: p.x, y: p.y, vx: Math.cos(ang) * 480, vy: Math.sin(ang) * 480, angle: ang, damage: Math.round(p.skills.bijuuBomb.damage * dmgMult), blastRadius: p.skills.bijuuBomb.radius, pierce: 1, hitIds: new Set(), radius: 17, life: 1.9 });
                    }
                }
            }
        }

        if (p.skills.rasengan.level > 0) { p.skills.rasengan.timer -= dt; if (p.skills.rasengan.timer <= 0) { p.skills.rasengan.timer = p.skills.rasengan.cooldown * cdMult; const r = p.skills.rasengan.radius; io.to(room.code).emit('fx', { type: 'rasengan', x: Math.round(p.x), y: Math.round(p.y), r }); io.to(room.code).emit('sfx', 'rasengan'); for (const e of room.enemies) if (Math.hypot(e.x - p.x, e.y - p.y) < r + e.radius) { damageEnemy(room, e, p.skills.rasengan.damage * dmgMult, p, '#38bdf8'); e.slowTimer = 1.1; e.slowFactor = 0.48; } damagePropsInRadius(room, p.x, p.y, r, p.skills.rasengan.damage * dmgMult); } }
        if (p.skills.raikiri.level > 0) { const rk = p.skills.raikiri, time = room.gameTime * rk.speed; for (let i = 0; i < rk.count; i++) { const ang = time + ((Math.PI * 2) / rk.count) * i, sx = p.x + Math.cos(ang) * rk.radius, sy = p.y + Math.sin(ang) * rk.radius; for (const e of room.enemies) if (e.hitTimer <= 0 && Math.hypot(e.x - sx, e.y - sy) < 16 + e.radius) damageEnemy(room, e, rk.damage * dmgMult, p, '#7dd3fc', 280); for (const prp of room.props) if (prp.hitTimer <= 0 && Math.hypot(prp.x - sx, prp.y - sy) < 16 + prp.radius) damageProp(room, prp, rk.damage * dmgMult); } }
        if (p.skills.lightning.level > 0 && room.enemies.length > 0) { p.skills.lightning.timer -= dt; if (p.skills.lightning.timer <= 0) { p.skills.lightning.timer = p.skills.lightning.cooldown * cdMult; const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 440).sort(() => 0.5 - Math.random()).slice(0, p.skills.lightning.bolts); if (ts.length) { io.to(room.code).emit('sfx', 'rasengan'); for (const t of ts) { io.to(room.code).emit('fx', { type: 'lightning', x1: Math.round(p.x), y1: Math.round(p.y - 12), x2: Math.round(t.x), y2: Math.round(t.y) }); damageEnemy(room, t, p.skills.lightning.damage * dmgMult, p, '#c084fc'); } } } }
        if (p.skills.fireball.level > 0 && room.enemies.length > 0) { p.skills.fireball.timer -= dt; if (p.skills.fireball.timer <= 0) { p.skills.fireball.timer = p.skills.fireball.cooldown * cdMult; let nearest = null, minD = Infinity; for (const e of room.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < minD) { minD = d; nearest = e; } } if (nearest && minD < 720) { const ang = Math.atan2(nearest.y - p.y, nearest.x - p.x); room.projectiles.push({ id: room.nextEntityId++, ownerId: p.id, kind: 'fireball', x: p.x, y: p.y, vx: Math.cos(ang) * 440, vy: Math.sin(ang) * 440, angle: ang, damage: p.skills.fireball.damage * dmgMult, blastRadius: p.skills.fireball.radius, pierce: 1, hitIds: new Set(), radius: 15, life: 2.0 }); io.to(room.code).emit('sfx', 'kunai'); } } }
        if (p.skills.amaterasu.level > 0 && room.enemies.length > 0) { p.skills.amaterasu.timer -= dt; if (p.skills.amaterasu.timer <= 0) { p.skills.amaterasu.timer = p.skills.amaterasu.cooldown * cdMult; const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 450).sort(() => 0.5 - Math.random()).slice(0, p.skills.amaterasu.count); if (ts.length) { io.to(room.code).emit('sfx', 'rasengan'); for (const t of ts) { const r = p.skills.amaterasu.radius; io.to(room.code).emit('fx', { type: 'amaterasu', x: Math.round(t.x), y: Math.round(t.y), r }); for (const e of room.enemies) if (Math.hypot(e.x - t.x, e.y - t.y) <= r + e.radius) damageEnemy(room, e, p.skills.amaterasu.damage * dmgMult, p, '#a855f7', 35); damagePropsInRadius(room, t.x, t.y, r, p.skills.amaterasu.damage * dmgMult); } } } }
        if (p.skills.cherrySmash.level > 0) { p.skills.cherrySmash.timer -= dt; if (p.skills.cherrySmash.timer <= 0) { p.skills.cherrySmash.timer = p.skills.cherrySmash.cooldown * cdMult; const r = p.skills.cherrySmash.radius; io.to(room.code).emit('fx', { type: 'smash', x: Math.round(p.x), y: Math.round(p.y), r }); io.to(room.code).emit('sfx', 'rasengan'); for (const e of room.enemies) if (Math.hypot(e.x - p.x, e.y - p.y) <= r + e.radius) damageEnemy(room, e, p.skills.cherrySmash.damage * dmgMult, p, '#f472b6', 380); damagePropsInRadius(room, p.x, p.y, r, p.skills.cherrySmash.damage * dmgMult); } }
        if (p.skills.byakugou.level > 0) { p.skills.byakugou.timer -= dt; if (p.skills.byakugou.timer <= 0) { p.skills.byakugou.timer = p.skills.byakugou.cooldown; const r = p.skills.byakugou.radius, healAmt = p.skills.byakugou.heal; io.to(room.code).emit('fx', { type: 'heal', x: Math.round(p.x), y: Math.round(p.y), r }); io.to(room.code).emit('sfx', 'gem'); for (const ally of alivePlayers) if (Math.hypot(ally.x - p.x, ally.y - p.y) <= r) { ally.hp = Math.min(ally.maxHp, ally.hp + healAmt); io.to(room.code).emit('fx', { type: 'dmg', x: Math.round(ally.x), y: Math.round(ally.y - 45), val: `+${healAmt}`, color: '#4ade80' }); } } }
        if (p.skills.shadowBind.level > 0) { p.skills.shadowBind.timer -= dt; if (p.skills.shadowBind.timer <= 0) { p.skills.shadowBind.timer = p.skills.shadowBind.cooldown * cdMult; const r = p.skills.shadowBind.radius; for (const e of room.enemies) if (Math.hypot(e.x - p.x, e.y - p.y) <= r + e.radius) { damageEnemy(room, e, p.skills.shadowBind.damage * dmgMult, p, '#94a3b8', 15); e.slowTimer = 1.2; e.slowFactor = 0.30; } } }
        if (p.skills.shadowStitch.level > 0 && room.enemies.length > 0) { p.skills.shadowStitch.timer -= dt; if (p.skills.shadowStitch.timer <= 0) { p.skills.shadowStitch.timer = p.skills.shadowStitch.cooldown * cdMult; const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 400).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, p.skills.shadowStitch.spikes); if (ts.length) { io.to(room.code).emit('sfx', 'hit'); for (const t of ts) { io.to(room.code).emit('fx', { type: 'shadowStitch', x1: Math.round(p.x), y1: Math.round(p.y + 18), x2: Math.round(t.x), y2: Math.round(t.y + 10) }); damageEnemy(room, t, p.skills.shadowStitch.damage * dmgMult, p, '#cbd5e1', 50); t.slowTimer = 1.0; t.slowFactor = 0.35; } } } }
        if (p.skills.hiraishin.level > 0 && room.enemies.length > 0) { p.skills.hiraishin.timer -= dt; if (p.skills.hiraishin.timer <= 0) { p.skills.hiraishin.timer = p.skills.hiraishin.cooldown * cdMult; const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 480).sort(() => 0.5 - Math.random()).slice(0, p.skills.hiraishin.strikes); if (ts.length) { io.to(room.code).emit('sfx', 'rasengan'); let px = p.x, py = p.y; for (const t of ts) { io.to(room.code).emit('fx', { type: 'hiraishin', x1: Math.round(px), y1: Math.round(py), x2: Math.round(t.x), y2: Math.round(t.y) }); damageEnemy(room, t, p.skills.hiraishin.damage * dmgMult, p, '#facc15', 60); px = t.x; py = t.y; } } } }
        if (p.skills.waterDragon.level > 0 && room.enemies.length > 0) { p.skills.waterDragon.timer -= dt; if (p.skills.waterDragon.timer <= 0) { p.skills.waterDragon.timer = p.skills.waterDragon.cooldown * cdMult; const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 550).sort(() => 0.5 - Math.random()).slice(0, p.skills.waterDragon.count); if (ts.length) { io.to(room.code).emit('sfx', 'rasengan'); for (const t of ts) { const ang = Math.atan2(t.y - p.y, t.x - p.x); room.projectiles.push({ id: room.nextEntityId++, ownerId: p.id, kind: 'water_dragon', x: p.x, y: p.y, vx: Math.cos(ang) * 520, vy: Math.sin(ang) * 520, angle: ang, damage: p.skills.waterDragon.damage * dmgMult, blastRadius: p.skills.waterDragon.radius, pierce: 1, hitIds: new Set(), radius: 18, life: 1.8 }); } } } }
        if (p.skills.tandemBombs.level > 0 && room.enemies.length > 0) { p.skills.tandemBombs.timer -= dt; if (p.skills.tandemBombs.timer <= 0) { p.skills.tandemBombs.timer = p.skills.tandemBombs.cooldown * cdMult; const ts = room.enemies.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 460).sort(() => 0.5 - Math.random()).slice(0, p.skills.tandemBombs.count); if (ts.length) { io.to(room.code).emit('sfx', 'hit'); for (const t of ts) { const r = p.skills.tandemBombs.radius; io.to(room.code).emit('fx', { type: 'paper_bomb', x: Math.round(t.x), y: Math.round(t.y), r }); for (const e of room.enemies) if (Math.hypot(e.x - t.x, e.y - t.y) <= r + e.radius) damageEnemy(room, e, p.skills.tandemBombs.damage * dmgMult, p, '#fb923c', 180); damagePropsInRadius(room, t.x, t.y, r, p.skills.tandemBombs.damage * dmgMult); } } } }
        if (p.skills.woodDragon.level > 0) { const wd = p.skills.woodDragon, time = room.gameTime * wd.speed; for (let i = 0; i < wd.count; i++) { const ang = time + ((Math.PI * 2) / wd.count) * i, sx = p.x + Math.cos(ang) * wd.radius, sy = p.y + Math.sin(ang) * wd.radius; for (const e of room.enemies) if (e.hitTimer <= 0 && Math.hypot(e.x - sx, e.y - sy) < 20 + e.radius) { damageEnemy(room, e, wd.damage * dmgMult, p, '#a3e635', 260); p.hp = Math.min(p.maxHp, p.hp + 1.5); } for (const prp of room.props) if (prp.hitTimer <= 0 && Math.hypot(prp.x - sx, prp.y - sy) < 20 + prp.radius) damageProp(room, prp, wd.damage * dmgMult); } }
        if (p.skills.senpoBuddha.level > 0) { p.skills.senpoBuddha.timer -= dt; if (p.skills.senpoBuddha.timer <= 0) { p.skills.senpoBuddha.timer = p.skills.senpoBuddha.cooldown * cdMult; const r = p.skills.senpoBuddha.radius; io.to(room.code).emit('fx', { type: 'buddha_hands', x: Math.round(p.x), y: Math.round(p.y), r }); io.to(room.code).emit('sfx', 'rasengan'); for (const e of room.enemies) if (Math.hypot(e.x - p.x, e.y - p.y) <= r + e.radius) damageEnemy(room, e, p.skills.senpoBuddha.damage * dmgMult, p, '#fde047', 350); damagePropsInRadius(room, p.x, p.y, r, p.skills.senpoBuddha.damage * dmgMult); } }
    }

    // 敵人生成：上限 100 個，且 BOSS 出現期間暫停生成小怪直至 BOSS 死亡
    const hasActiveBoss = room.enemies.some(e => e.isBoss && e.hp > 0);
    const blockSpawnByBoss = SERVER_BALANCE.stopSpawnDuringBoss && hasActiveBoss;
    room.spawnTimer -= dt;
    if (!blockSpawnByBoss && room.spawnTimer <= 0 && room.enemies.length < SERVER_BALANCE.maxEnemies) {
        const playerScale = 1 + (players.length - 1) * 0.55, spawnRate = Math.max(0.22, (0.95 - room.gameTime / 280) / playerScale);
        const remainSlots = SERVER_BALANCE.maxEnemies - room.enemies.length;
        const spawnCount = Math.min(remainSlots, Math.max(1, Math.floor((1 + room.gameTime / 45) * (1 + (players.length - 1) * 0.35))));
        const hpMult = (1 + room.gameTime / 110) * (1 + (players.length - 1) * 0.25);
        for (let i = 0; i < spawnCount; i++) {
            const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)], angle = Math.random() * Math.PI * 2, dist = 840 + Math.random() * 140, rand = Math.random();
            let type = 'basic'; if (room.gameTime > 18 && rand < 0.28) type = 'fast'; if (room.gameTime > 42 && rand > 0.88) type = 'elite';
            const st = type === 'basic' ? { radius: 21, speed: 92, hp: Math.round(30 * hpMult), damage: 11, xp: 3 } : type === 'fast' ? { radius: 19, speed: 170, hp: Math.round(18 * hpMult), damage: 8, xp: 4 } : { radius: 29, speed: 60, hp: Math.round(170 * hpMult), damage: 24, xp: 14 };
            room.enemies.push({ id: room.nextEntityId++, type, isBoss: false, x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist, vx: 0, vy: 0, kbVx: 0, kbVy: 0, facing: 'left', hp: st.hp, maxHp: st.hp, speed: st.speed, damage: st.damage, radius: st.radius, xpValue: st.xp, hitTimer: 0, slowTimer: 0, slowFactor: 0.48 });
        }
        room.spawnTimer = spawnRate;
    }

    for (let i = room.projectiles.length - 1; i >= 0; i--) {
        const proj = room.projectiles[i]; proj.x += proj.vx * dt; proj.y += proj.vy * dt; proj.life -= dt;
        if (proj.life <= 0) { room.projectiles.splice(i, 1); continue; }
        const owner = room.players.get(proj.ownerId);
        let destroyed = false;
        for (let j = room.enemies.length - 1; j >= 0; j--) {
            const e = room.enemies[j]; if (proj.hitIds && proj.hitIds.has(e.id)) continue;
            if (Math.hypot(proj.x - e.x, proj.y - e.y) < proj.radius + e.radius) {
                if (proj.hitIds) proj.hitIds.add(e.id);
                if (proj.kind === 'fireball' || proj.kind === 'bijuu_bomb') {
                    io.to(room.code).emit('fx', { type: 'explosion', x: Math.round(proj.x), y: Math.round(proj.y), r: proj.blastRadius }); io.to(room.code).emit('sfx', 'rasengan');
                    for (const t of room.enemies) if (Math.hypot(t.x - proj.x, t.y - proj.y) <= proj.blastRadius + t.radius) damageEnemy(room, t, proj.damage, owner, proj.kind === 'bijuu_bomb' ? '#facc15' : '#fb923c', 220);
                    damagePropsInRadius(room, proj.x, proj.y, proj.blastRadius, proj.damage);
                    destroyed = true; break;
                } else if (proj.kind === 'water_dragon') { io.to(room.code).emit('fx', { type: 'water_splash', x: Math.round(proj.x), y: Math.round(proj.y), r: proj.blastRadius }); io.to(room.code).emit('sfx', 'rasengan'); for (const t of room.enemies) if (Math.hypot(t.x - proj.x, t.y - proj.y) <= proj.blastRadius + t.radius) damageEnemy(room, t, proj.damage, owner, '#38bdf8', 240); damagePropsInRadius(room, proj.x, proj.y, proj.blastRadius, proj.damage); destroyed = true; break; }
                else {
                    damageEnemy(room, e, proj.damage, owner, proj.kind === 'rasenshuriken' ? '#facc15' : proj.kind === 'suidanha' ? '#38bdf8' : proj.kind === 'wood_root' ? '#a3e635' : '#fde047');
                    if (proj.kind === 'wood_root') { e.slowTimer = 1.2; e.slowFactor = 0.35; }
                    proj.pierce = (proj.pierce || 1) - 1; if (proj.pierce <= 0) { destroyed = true; break; }
                }
            }
        }
        if (!destroyed) {
            for (const prp of room.props) {
                if (prp.hp > 0 && (!proj.hitIds || !proj.hitIds.has('p_' + prp.id)) && Math.hypot(proj.x - prp.x, proj.y - prp.y) < proj.radius + prp.radius) {
                    if (proj.hitIds) proj.hitIds.add('p_' + prp.id);
                    damageProp(room, prp, proj.damage);
                    proj.pierce = (proj.pierce || 1) - 1; if (proj.pierce <= 0) { destroyed = true; break; }
                }
            }
        }
        if (destroyed) room.projectiles.splice(i, 1);
    }

    for (let i = room.props.length - 1; i >= 0; i--) {
        const prp = room.props[i]; if (prp.hitTimer > 0) prp.hitTimer = Math.max(0, prp.hitTimer - dt);
        if (prp.hp <= 0 || !alivePlayers.some(p => Math.hypot(p.x - prp.x, p.y - prp.y) <= 1500)) room.props.splice(i, 1);
    }

    for (let i = room.enemies.length - 1; i >= 0; i--) {
        const e = room.enemies[i]; if (e.hp <= 0) { room.enemies.splice(i, 1); continue; }
        if (e.hitTimer > 0) e.hitTimer = Math.max(0, e.hitTimer - dt);
        if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);
        if (e.isBoss) updateBossSkills(room, e, alivePlayers, dt);
        let target = alivePlayers[0], minD = Infinity;
        for (const p of alivePlayers) { const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < minD) { minD = d; target = p; } }
        const spd = e.slowTimer > 0 ? e.speed * (e.slowFactor || 0.48) : e.speed;
        e.kbVx *= 0.88; e.kbVy *= 0.88;
        const angle = Math.atan2(target.y - e.y, target.x - e.x); e.facing = Math.cos(angle) >= 0 ? 'right' : 'left';
        e.vx = Math.cos(angle) * spd + e.kbVx; e.vy = Math.sin(angle) * spd + e.kbVy;
        e.x += e.vx * dt; e.y += e.vy * dt;
        for (const p of alivePlayers) if (Math.hypot(p.x - e.x, p.y - e.y) < p.radius + e.radius - 4) hurtPlayer(room, p, e.damage, players);
    }

    for (let i = room.enemyProjectiles.length - 1; i >= 0; i--) {
        const ep = room.enemyProjectiles[i]; ep.x += ep.vx * dt; ep.y += ep.vy * dt; ep.life -= dt;
        if (ep.life <= 0) { room.enemyProjectiles.splice(i, 1); continue; }
        for (const p of alivePlayers) if (Math.hypot(p.x - ep.x, p.y - ep.y) < p.radius + ep.radius) { hurtPlayer(room, p, ep.damage, players); room.enemyProjectiles.splice(i, 1); break; }
    }

    for (let i = room.hazards.length - 1; i >= 0; i--) {
        const hz = room.hazards[i]; hz.delay -= dt;
        if (hz.delay <= 0) {
            io.to(room.code).emit('fx', { type: 'hazard_burst', kind: hz.kind, x: hz.x, y: hz.y, r: hz.r });
            for (const p of alivePlayers) {
                if (Math.hypot(p.x - hz.x, p.y - hz.y) <= hz.r + p.radius) {
                    hurtPlayer(room, p, hz.damage, players);
                    if (hz.knockback) { const pa = Math.atan2(p.y - hz.y, p.x - hz.x); p.x += Math.cos(pa) * 110; p.y += Math.sin(pa) * 110; }
                }
            }
            room.hazards.splice(i, 1);
        }
    }

    for (let i = room.items.length - 1; i >= 0; i--) {
        const it = room.items[i]; it.life -= dt;
        if (it.life <= 0) { room.items.splice(i, 1); continue; }
        let magnetUser = null, minMagD = Infinity;
        for (const p of alivePlayers) if (p.magnetTimer > 0) { const d = Math.hypot(p.x - it.x, p.y - it.y); if (d < 1100 && d < minMagD) { minMagD = d; magnetUser = p; } }
        if (magnetUser) { const ang = Math.atan2(magnetUser.y - it.y, magnetUser.x - it.x); it.x += Math.cos(ang) * 560 * dt; it.y += Math.sin(ang) * 560 * dt; }
        for (const p of alivePlayers) if (Math.hypot(p.x - it.x, p.y - it.y) < p.radius + 16) { room.items.splice(i, 1); triggerItemPickup(room, p, it); break; }
    }

    for (let i = room.gems.length - 1; i >= 0; i--) {
        const g = room.gems[i]; let collector = null, minD = Infinity;
        for (const p of alivePlayers) {
            const range = p.magnetTimer > 0 ? 1100 : (p.scrollTimer > 0 && p.scrollType === 'power' ? p.pickupRange * 1.5 : p.pickupRange);
            const d = Math.hypot(p.x - g.x, p.y - g.y);
            if (d < range && d < minD) { minD = d; collector = p; }
        }
        if (collector) {
            const pullSpd = collector.magnetTimer > 0 ? 640 : 490;
            const ang = Math.atan2(collector.y - g.y, collector.x - g.x);
            g.x += Math.cos(ang) * pullSpd * dt; g.y += Math.sin(ang) * pullSpd * dt;
            if (Math.hypot(collector.x - g.x, collector.y - g.y) < collector.radius + 14) {
                room.teamXp += g.value; room.gems.splice(i, 1); io.to(room.code).emit('sfx', 'gem');
                if (room.teamXp >= room.teamXpNext && room.state === 'PLAYING') { triggerTeamLevelUp(room); break; }
            }
        }
    }
}

setInterval(() => {
    const dt = 1 / 30;
    for (const room of rooms.values()) {
        stepRoom(room, dt);
        if (room.state === 'PLAYING' || room.state === 'LEVELUP' || room.state === 'PAUSED') {
            io.volatile.to(room.code).emit('state', {
                t: room.gameTime, lv: room.teamLevel, xp: room.teamXp, xpNext: room.teamXpNext, kills: room.totalKills,
                players: Array.from(room.players.values()).map(p => ({
                    id: p.id, name: p.name, charId: p.charId, x: Math.round(p.x), y: Math.round(p.y),
                    vx: Math.round(p.vx), vy: Math.round(p.vy), spd: Math.round(p.effSpeed || p.speed),
                    facing: p.facing, moving: p.dx !== 0 || p.dy !== 0, hp: p.hp, maxHp: p.maxHp, kills: p.kills,
                    hit: p.hitTimer > 0.35, downed: p.downed, revive: Number(p.reviveProgress.toFixed(2)), wCount: p.weapon.count,
                    magnetT: Number(p.magnetTimer.toFixed(1)), scrollT: Number(p.scrollTimer.toFixed(1)),
                    rasenLv: p.skills.rasengan.level, rasenR: p.skills.rasengan.radius, bijuuLv: p.skills.bijuuBomb.level,
                    raikiriLv: p.skills.raikiri.level, raikiriCnt: p.skills.raikiri.count, raikiriR: p.skills.raikiri.radius, raikiriSpd: p.skills.raikiri.speed,
                    lightLv: p.skills.lightning.level, fireLv: p.skills.fireball.level, amatLv: p.skills.amaterasu.level,
                    smashLv: p.skills.cherrySmash.level, healLv: p.skills.byakugou.level,
                    shadowLv: p.skills.shadowBind.level, shadowR: p.skills.shadowBind.radius, stitchLv: p.skills.shadowStitch.level,
                    hiraiLv: p.skills.hiraishin.level, wDragLv: p.skills.waterDragon.level, bombLv: p.skills.tandemBombs.level,
                    woodDragLv: p.skills.woodDragon.level, woodDragCnt: p.skills.woodDragon.count, woodDragR: p.skills.woodDragon.radius,
                    buddhaLv: p.skills.senpoBuddha.level, clones: p.skills.clones
                })),
                enemies: room.enemies.map(e => ({ id: e.id, type: e.type, isBoss: !!e.isBoss, bossTitle: e.bossTitle || '', x: Math.round(e.x), y: Math.round(e.y), vx: Math.round(e.vx), vy: Math.round(e.vy), facing: e.facing, hp: e.hp, maxHp: e.maxHp, hit: e.hitTimer > 0, slow: e.slowTimer > 0 })),
                props: room.props.map(prp => ({ id: prp.id, kind: prp.kind, x: prp.x, y: prp.y, hit: prp.hitTimer > 0 })),
                items: room.items.map(it => ({ id: it.id, kind: it.kind, x: Math.round(it.x), y: Math.round(it.y) })),
                projectiles: room.projectiles.map(pr => ({ id: pr.id, kind: pr.kind, x: Math.round(pr.x), y: Math.round(pr.y), vx: Math.round(pr.vx), vy: Math.round(pr.vy), angle: Number(pr.angle.toFixed(2)) })),
                enemyProjectiles: room.enemyProjectiles.map(ep => ({ id: ep.id, kind: ep.kind, x: Math.round(ep.x), y: Math.round(ep.y), vx: Math.round(ep.vx), vy: Math.round(ep.vy), angle: Number(ep.angle.toFixed(2)) })),
                hazards: room.hazards.map(hz => ({ id: hz.id, kind: hz.kind, x: hz.x, y: hz.y, r: hz.r, progress: Number((1 - hz.delay / hz.maxDelay).toFixed(2)) })),
                gems: room.gems.map(g => ({ id: g.id, x: Math.round(g.x), y: Math.round(g.y), val: g.value }))
            });
        }
    }
}, 1000 / 30);

io.on('connection', (socket) => {
    let currentRoomCode = null;
    socket.emit('globalLeaderboardUpdate', globalLeaderboard);

    function removePlayerFromRoom() {
        if (!currentRoomCode) return;
        const code = currentRoomCode; currentRoomCode = null; socket.leave(code);
        const room = rooms.get(code); if (!room) return;
        room.players.delete(socket.id);
        if (!room.players.size) { rooms.delete(code); return; }
        if (room.hostId === socket.id) room.hostId = Array.from(room.players.keys())[0];
        if (room.state === 'LOBBY') broadcastLobby(room);
        else if (room.state === 'LEVELUP') emitUpgradeStatus(room);
    }

    socket.on('pingCheck', (cb) => { if (typeof cb === 'function') cb(); });
    socket.on('getLeaderboard', async () => { socket.emit('globalLeaderboardUpdate', await fetchGistLeaderboard()); });
    socket.on('submitSoloScore', async (entry) => {
        if (!entry || typeof entry.time !== 'number') return;
        await recordGlobalScore({ entryId: entry.entryId || `${Date.now()}`, name: String(entry.name || '木葉忍者').slice(0, 12), charId: CHAR_CONFIG[entry.charId] ? entry.charId : 'naruto', teamNames: String(entry.name || '木葉忍者').slice(0, 12), modeLabel: '單機挑戰', time: Math.floor(entry.time), level: Math.max(1, Math.floor(entry.level || 1)), kills: Math.max(0, Math.floor(entry.kills || 0)) });
    });

    socket.on('createRoom', ({ name, charId }) => {
        removePlayerFromRoom();
        const code = generateRoomCode();
        const room = { code, hostId: socket.id, state: 'LOBBY', pausedBy: null, players: new Map(), enemies: [], props: [], items: [], projectiles: [], enemyProjectiles: [], hazards: [], gems: [], bossSpawned: {}, gameTime: 0, teamLevel: 1, teamXp: 0, teamXpNext: 30, totalKills: 0, spawnTimer: 0, propSpawnTimer: 2.5, nextEntityId: 1 };
        room.players.set(socket.id, createPlayerState(socket.id, name, 0, CHAR_CONFIG[charId] ? charId : 'naruto'));
        rooms.set(code, room); currentRoomCode = code; socket.join(code); broadcastLobby(room);
    });

    socket.on('joinRoom', ({ code, name, charId }) => {
        removePlayerFromRoom();
        const cleanCode = (code || '').trim(), room = rooms.get(cleanCode);
        if (!room) { socket.emit('roomError', '找不到此房間號碼，請確認房號是否正確！'); return; }
        if (room.state !== 'LOBBY') { socket.emit('roomError', '該房間遊戲已經開始，請等下一局！'); return; }
        if (room.players.size >= 3) { socket.emit('roomError', '房間已滿（最多 3 人合作）！'); return; }
        room.players.set(socket.id, createPlayerState(socket.id, name, room.players.size, CHAR_CONFIG[charId] ? charId : 'kakashi'));
        currentRoomCode = cleanCode; socket.join(cleanCode); broadcastLobby(room);
    });

    socket.on('leaveRoom', removePlayerFromRoom);
    socket.on('selectChar', (charId) => { const room = rooms.get(currentRoomCode); if (room && room.state === 'LOBBY' && CHAR_CONFIG[charId]) { const p = room.players.get(socket.id); if (p) { p.charId = charId; broadcastLobby(room); } } });
    socket.on('startGame', () => { const room = rooms.get(currentRoomCode); if (room && room.hostId === socket.id) startRoomGame(room); });
    socket.on('togglePause', () => {
        const room = rooms.get(currentRoomCode), p = room?.players.get(socket.id);
        if (!room || !p) return;
        if (room.state === 'PLAYING') { room.state = 'PAUSED'; room.pausedBy = p.name; io.to(room.code).emit('gamePaused', { pausedBy: p.name }); }
        else if (room.state === 'PAUSED') { room.state = 'PLAYING'; room.pausedBy = null; io.to(room.code).emit('gameResumed'); }
    });
    socket.on('input', ({ dx, dy }) => { const p = rooms.get(currentRoomCode)?.players.get(socket.id); if (p) { p.dx = Math.max(-1, Math.min(1, Number(dx) || 0)); p.dy = Math.max(-1, Math.min(1, Number(dy) || 0)); } });
    socket.on('chooseUpgrade', (upgradeId) => {
        const room = rooms.get(currentRoomCode), p = room?.players.get(socket.id);
        if (room && room.state === 'LEVELUP' && p && p.pendingUpgrade) { applyPlayerUpgrade(p, upgradeId); p.pendingUpgrade = false; emitUpgradeStatus(room); }
    });
    socket.on('disconnect', removePlayerFromRoom);
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
