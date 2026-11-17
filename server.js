const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('Naruto Survivors 3-Player Co-op Server (9 Shinobi & 4 Bosses Edition) is Running!');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

/**
 * ============================================================================
 * 全服所有玩家排行榜持久化儲存 (Global Leaderboard)
 * ============================================================================
 */
const LB_FILE = path.join(__dirname, 'leaderboard.json');
let globalLeaderboard = [];

function loadLeaderboard() {
    try {
        if (fs.existsSync(LB_FILE)) {
            const raw = fs.readFileSync(LB_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) globalLeaderboard = parsed;
        }
    } catch (err) {
        console.error('Failed to load leaderboard:', err.message);
    }
}

function saveLeaderboard() {
    try {
        fs.writeFileSync(LB_FILE, JSON.stringify(globalLeaderboard, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save leaderboard:', err.message);
    }
}

function recordGlobalScore(entry) {
    globalLeaderboard.push(entry);
    globalLeaderboard.sort((a, b) => (b.time - a.time) || (b.kills - a.kills));
    globalLeaderboard = globalLeaderboard.slice(0, 10);
    saveLeaderboard();
    return globalLeaderboard;
}

loadLeaderboard();

const CHAR_CONFIG = {
    naruto: {
        name: '漩渦鳴人',
        maxHp: 110,
        speed: 225,
        regen: 0,
        weapon: 'shuriken',
        cooldown: 0.95,
        damage: 20,
        count: 1
    },
    kakashi: {
        name: '旗木卡卡西',
        maxHp: 95,
        speed: 245,
        regen: 0,
        weapon: 'kunai',
        cooldown: 1.05,
        damage: 28,
        count: 1
    },
    jiraiya: {
        name: '自來也',
        maxHp: 135,
        speed: 200,
        regen: 0,
        weapon: 'needle',
        cooldown: 1.35,
        damage: 16,
        count: 3
    },
    sasuke: {
        name: '宇智波佐助',
        maxHp: 100,
        speed: 240,
        regen: 0,
        weapon: 'chidori_senbon',
        cooldown: 0.92,
        damage: 24,
        count: 1
    },
    sakura: {
        name: '春野櫻',
        maxHp: 130,
        speed: 215,
        regen: 1.5,
        weapon: 'cherry_kunai',
        cooldown: 1.15,
        damage: 30,
        count: 1
    },
    shikamaru: {
        name: '奈良鹿丸',
        maxHp: 105,
        speed: 220,
        regen: 0,
        weapon: 'trench_knife',
        cooldown: 1.10,
        damage: 22,
        count: 1
    },
    minato: {
        name: '波風水門',
        maxHp: 115,
        speed: 265,
        regen: 0,
        weapon: 'hiraishin_kunai',
        cooldown: 0.82,
        damage: 25,
        count: 2
    },
    tobirama: {
        name: '千手扉間',
        maxHp: 145,
        speed: 255,
        regen: 1.0,
        weapon: 'water_sever',
        cooldown: 0.85,
        damage: 34,
        count: 1
    },
    hashirama: {
        name: '千手柱間',
        maxHp: 200,
        speed: 245,
        regen: 3.5,
        weapon: 'wood_dragon',
        cooldown: 0.90,
        damage: 42,
        count: 1
    }
};

const UPGRADE_POOL = {
    naruto: [
        { id: 'w_count', title: '多重手裏劍', desc: '手裏劍每次額外投擲 +1 枚' },
        { id: 'w_dmg', title: '風遁・查克拉注入', desc: '手裏劍傷害提升 +12' },
        { id: 'w_cd', title: '影分身結印加速', desc: '主武器冷卻縮短 20%' },
        { id: 'rasengan', title: '螺旋丸領域', desc: '解鎖/擴大周身螺旋丸氣流（週期傷害＋減速）' },
        { id: 'clone', title: '多重影分身之術', desc: '召喚 1 名鳴人分身自動投擲手裏劍（上限 2 名）' },
        { id: 'hp', title: '九尾查克拉恢復', desc: '最大生命 +30 並回復 60 HP' },
        { id: 'speed', title: '瞬身疾走', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '查克拉吸引', desc: '寶石拾取範圍擴大 50%' }
    ],
    kakashi: [
        { id: 'w_count', title: '暗部連射苦無', desc: '苦無每次額外發射 +1 把' },
        { id: 'w_dmg', title: '雷切附魔苦無', desc: '苦無暴擊傷害提升 +15' },
        { id: 'w_cd', title: '寫輪眼動態視力', desc: '主武器冷卻縮短 22%' },
        { id: 'raikiri', title: '雷切・環繞雷球', desc: '解鎖/增加 +1 顆高壓雷球環繞護身並擊退敵人' },
        { id: 'lightning', title: '雷遁・連鎖紫電', desc: '解鎖/強化自動落雷，在敵群之間連鎖彈跳' },
        { id: 'hp', title: '上忍戰鬥體魄', desc: '最大生命 +25 並回復 50 HP' },
        { id: 'speed', title: '雷遁神速', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '查克拉感知', desc: '寶石拾取範圍擴大 50%' }
    ],
    jiraiya: [
        { id: 'w_count', title: '亂獅子髮・千本擴散', desc: '千本散射數量額外 +2 根' },
        { id: 'w_dmg', title: '仙法・鋼針硬化', desc: '千本針傷害提升 +10' },
        { id: 'w_cd', title: '高速結印', desc: '主武器冷卻縮短 20%' },
        { id: 'fireball', title: '火遁・大炎彈', desc: '解鎖/強化巨型火球，命中產生大範圍烈焰爆炸' },
        { id: 'rasengan', title: '仙法・超大玉螺旋丸', desc: '解鎖/擴大周身仙術氣場（傷害＋減速）' },
        { id: 'hp', title: '妙木山仙人體質', desc: '最大生命 +40 並回復 80 HP' },
        { id: 'speed', title: '蛤蟆跳躍步法', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '仙術自然感知', desc: '寶石拾取範圍擴大 50%' }
    ],
    sasuke: [
        { id: 'w_count', title: '千鳥千本齊射', desc: '千鳥千本每次額外發射 +1 根' },
        { id: 'w_dmg', title: '草薙劍氣增幅', desc: '千鳥千本傷害提升 +14' },
        { id: 'w_cd', title: '萬花筒動態洞察', desc: '主武器冷卻縮短 22%' },
        { id: 'raikiri', title: '千鳥流・環繞雷刃', desc: '解鎖/增加 +1 道高壓雷刃環繞護身並擊退敵人' },
        { id: 'amaterasu', title: '天照・不滅黑炎', desc: '解鎖/強化黑炎爆發，焚燒周圍敵群' },
        { id: 'hp', title: '咒印生命力', desc: '最大生命 +25 並回復 50 HP' },
        { id: 'speed', title: '雷遁瞬步', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '寫輪眼瞳力', desc: '寶石拾取範圍擴大 50%' }
    ],
    sakura: [
        { id: 'w_count', title: '連環櫻花苦無', desc: '櫻花苦無每次額外投擲 +1 把' },
        { id: 'w_dmg', title: '怪力查克拉集中', desc: '苦無與體術傷害提升 +16' },
        { id: 'w_cd', title: '醫療忍者精準控制', desc: '主武器冷卻縮短 20%' },
        { id: 'cherry_smash', title: '櫻花衝・怪力震擊', desc: '解鎖/擴大地面震擊波，重創並震飛周圍敵人' },
        { id: 'byakugou', title: '百豪之印・掌仙術', desc: '解鎖/強化週期性治療光環，同時回復自身與隊友生命' },
        { id: 'hp', title: '百豪查克拉儲備', desc: '最大生命 +40 並回復 80 HP' },
        { id: 'speed', title: '體術迴避步法', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '精細查克拉感知', desc: '寶石拾取範圍擴大 50%' }
    ],
    shikamaru: [
        { id: 'w_count', title: '飛燕・雙重查克拉刀', desc: '查克拉刀每次額外投擲 +1 把' },
        { id: 'w_dmg', title: '阿斯瑪之刃銳化', desc: '查克拉刀傷害提升 +13' },
        { id: 'w_cd', title: '兩百智商戰術連攜', desc: '主武器冷卻縮短 22%' },
        { id: 'shadow_bind', title: '影子模仿術・領域', desc: '解鎖/擴大腳下黑影領域，造成 70% 極強減速與持續傷害' },
        { id: 'shadow_stitch', title: '影子縫合術', desc: '解鎖/增加黑影尖刺數量，精準貫穿多名敵人' },
        { id: 'hp', title: '中忍戰術防護', desc: '最大生命 +30 並回復 60 HP' },
        { id: 'speed', title: '戰術撤離步法', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '戰場全局掌控', desc: '寶石拾取範圍擴大 60%' }
    ],
    minato: [
        { id: 'w_count', title: '飛雷神苦無陣', desc: '每次額外投擲 +1 把三叉飛雷神苦無' },
        { id: 'w_dmg', title: '九尾陰之力灌注', desc: '飛雷神苦無傷害提升 +15' },
        { id: 'w_cd', title: '黃色閃光神速', desc: '主武器冷卻縮短 24%' },
        { id: 'hiraishin', title: '飛雷神・二段閃光斬', desc: '解鎖/強化金色閃電瞬殺，連續斬擊多名敵人' },
        { id: 'rasengan', title: '螺旋丸・閃光領域', desc: '解鎖/擴大高速旋轉螺旋丸氣流（傷害＋減速）' },
        { id: 'hp', title: '四代目火影護佑', desc: '最大生命 +30 並回復 65 HP' },
        { id: 'speed', title: '時空間神速', desc: '移動速度再提升 15%' },
        { id: 'magnet', title: '飛雷神印記回收', desc: '寶石拾取範圍擴大 60%' }
    ],
    tobirama: [
        { id: 'w_count', title: '多重水斷波', desc: '超高壓水刃每次額外發射 +1 道（貫穿敵陣）' },
        { id: 'w_dmg', title: '水遁・極限水壓', desc: '水斷波基礎傷害提升 +18' },
        { id: 'w_cd', title: '水遁單手結印', desc: '主武器冷卻縮短 22%' },
        { id: 'water_dragon', title: '水遁・水龍彈之術', desc: '解鎖/強化咆哮水龍，衝擊敵群造成範圍水爆與擊退' },
        { id: 'hiraishin', title: '飛雷神斬・瞬殺', desc: '解鎖/強化時空間水雷斬擊，連續瞬殺多名敵人' },
        { id: 'hp', title: '千手一族體魄', desc: '最大生命 +35 並回復 75 HP' },
        { id: 'speed', title: '水瞬身之術', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '頂級感知能力', desc: '寶石拾取範圍擴大 60%' }
    ],
    hashirama: [
        { id: 'w_count', title: '雙木龍咆哮', desc: '木龍之術每次額外召喚 +1 條巨木龍貫穿敵軍' },
        { id: 'w_dmg', title: '仙法・木遁查克拉', desc: '木龍之術基礎傷害提升 +22' },
        { id: 'w_cd', title: '忍者之神結印', desc: '主武器冷卻縮短 24%' },
        { id: 'deep_forest', title: '木遁・樹界降誕', desc: '解鎖/擴大周身巨樹藤蔓領域，強力纏繞減速並持續碾壓敵人' },
        { id: 'shinsu_senju', title: '仙法・木遁・真數千手', desc: '解鎖/強化漫天千手佛拳，對範圍內敵群發動毀滅性連打' },
        { id: 'hp', title: '柱間細胞超回復', desc: '最大生命 +50、回血速度提升並立即回復 100 HP' },
        { id: 'speed', title: '仙人步法', desc: '移動速度永久提升 15%' },
        { id: 'magnet', title: '自然能量共鳴', desc: '寶石拾取範圍擴大 65%' }
    ]
};

const BOSS_SCHEDULE = [
    { time: 300, type: 'gaara', name: '砂瀑我愛羅', radius: 28, speed: 66, baseHp: 2800, damage: 22, xp: 80 },
    { time: 600, type: 'orochimaru', name: '傳說三忍・大蛇丸', radius: 30, speed: 82, baseHp: 6500, damage: 28, xp: 150 },
    { time: 900, type: 'itachi', name: '宇智波鼬', radius: 30, speed: 95, baseHp: 13500, damage: 34, xp: 250 },
    { time: 1800, type: 'pain', name: '曉之首領・佩恩', radius: 34, speed: 78, baseHp: 36000, damage: 42, xp: 600 }
];

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

function createPlayerState(id, name, slotIndex, charId = 'naruto') {
    const cfg = CHAR_CONFIG[charId] || CHAR_CONFIG.naruto;
    const spawnOffsets = [
        { x: 0, y: 0 },
        { x: -65, y: 45 },
        { x: 65, y: 45 }
    ];
    const pos = spawnOffsets[slotIndex] || { x: 0, y: 0 };

    return {
        id,
        name: name || `忍者 ${slotIndex + 1}`,
        slot: slotIndex,
        charId,
        x: pos.x,
        y: pos.y,
        dx: 0,
        dy: 0,
        vx: 0,
        vy: 0,
        radius: 20,
        facing: 'right',
        hp: cfg.maxHp,
        maxHp: cfg.maxHp,
        speed: cfg.speed,
        regen: cfg.regen || 0,
        pickupRange: 125,
        hitTimer: 0,
        downed: false,
        reviveProgress: 0,
        kills: 0,
        pendingUpgrade: false,
        weapon: {
            type: cfg.weapon,
            cooldown: cfg.cooldown,
            timer: 0.3,
            damage: cfg.damage,
            count: cfg.count
        },
        skills: {
            rasengan: { level: 0, radius: 120, damage: 13, timer: 0, cooldown: 0.9 },
            raikiri: { level: 0, count: 2, damage: 18, radius: 95, speed: 3.4 },
            lightning: { level: 0, bolts: 2, damage: 26, timer: 0, cooldown: 1.7 },
            fireball: { level: 0, damage: 34, radius: 85, timer: 0, cooldown: 1.8 },
            amaterasu: { level: 0, count: 2, damage: 28, radius: 68, timer: 0, cooldown: 1.6 },
            cherrySmash: { level: 0, radius: 135, damage: 32, timer: 0, cooldown: 1.75 },
            byakugou: { level: 0, heal: 14, radius: 185, timer: 0, cooldown: 3.5 },
            shadowBind: { level: 0, radius: 135, damage: 11, timer: 0, cooldown: 0.85 },
            shadowStitch: { level: 0, spikes: 3, damage: 25, timer: 0, cooldown: 1.55 },
            hiraishin: { level: 0, strikes: 3, damage: 30, timer: 0, cooldown: 1.35 },
            waterDragon: { level: 0, count: 1, damage: 45, radius: 75, timer: 0, cooldown: 1.65 },
            deepForest: { level: 0, radius: 165, damage: 18, timer: 0, cooldown: 0.85 },
            shinsuSenju: { level: 0, fists: 6, damage: 44, timer: 0, cooldown: 1.5 },
            clones: 0,
            cloneTimers: [0.4, 0.8]
        }
    };
}

function broadcastLobby(room) {
    const playersList = Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        charId: p.charId
    }));
    io.to(room.code).emit('lobbyUpdate', {
        code: room.code,
        hostId: room.hostId,
        players: playersList
    });
}

function startRoomGame(room) {
    room.state = 'PLAYING';
    room.pausedBy = null;
    room.gameTime = 0;
    room.teamLevel = 1;
    room.teamXp = 0;
    room.teamXpNext = 30;
    room.totalKills = 0;
    room.spawnTimer = 0.5;
    room.nextEntityId = 1;
    room.enemies = [];
    room.projectiles = [];
    room.enemyProjectiles = [];
    room.hazardZones = [];
    room.gems = [];
    room.spawnedBosses = new Set();

    let idx = 0;
    for (const [id, p] of room.players.entries()) {
        const fresh = createPlayerState(id, p.name, idx, p.charId);
        room.players.set(id, fresh);
        idx++;
    }

    io.to(room.code).emit('gameStarted');
}

function triggerTeamLevelUp(room) {
    room.state = 'LEVELUP';
    room.teamXp -= room.teamXpNext;
    room.teamLevel++;
    room.teamXpNext = Math.floor(room.teamXpNext * 1.45);

    for (const p of room.players.values()) {
        p.pendingUpgrade = true;
        const basePool = UPGRADE_POOL[p.charId] || UPGRADE_POOL.naruto;
        const pool = basePool.filter(u => {
            if (u.id === 'clone' && p.skills.clones >= 2) return false;
            return true;
        });
        pool.sort(() => 0.5 - Math.random());
        const choices = pool.slice(0, 3);
        io.to(p.id).emit('levelUpChoices', {
            level: room.teamLevel,
            choices
        });
    }
    emitUpgradeStatus(room);
}

function emitUpgradeStatus(room) {
    const waiting = Array.from(room.players.values()).filter(p => p.pendingUpgrade).length;
    io.to(room.code).emit('upgradeStatus', {
        waiting,
        total: room.players.size
    });
    if (waiting === 0 && room.state === 'LEVELUP') {
        if (room.teamXp >= room.teamXpNext) {
            triggerTeamLevelUp(room);
        } else {
            room.state = 'PLAYING';
            io.to(room.code).emit('resumeGame');
        }
    }
}

function applyPlayerUpgrade(p, upgradeId) {
    switch (upgradeId) {
        case 'w_count':
            p.weapon.count += (p.charId === 'jiraiya' ? 2 : 1);
            break;
        case 'w_dmg':
            p.weapon.damage += (p.charId === 'hashirama' ? 22 : p.charId === 'tobirama' ? 18 : 14);
            break;
        case 'w_cd':
            p.weapon.cooldown *= 0.79;
            break;
        case 'rasengan':
            if (p.skills.rasengan.level === 0) p.skills.rasengan.level = 1;
            else {
                p.skills.rasengan.level++;
                p.skills.rasengan.radius += 22;
                p.skills.rasengan.damage += 7;
            }
            break;
        case 'raikiri':
            if (p.skills.raikiri.level === 0) p.skills.raikiri.level = 1;
            else {
                p.skills.raikiri.level++;
                p.skills.raikiri.count++;
                p.skills.raikiri.damage += 8;
            }
            break;
        case 'lightning':
            if (p.skills.lightning.level === 0) p.skills.lightning.level = 1;
            else {
                p.skills.lightning.level++;
                p.skills.lightning.bolts++;
                p.skills.lightning.damage += 10;
            }
            break;
        case 'fireball':
            if (p.skills.fireball.level === 0) p.skills.fireball.level = 1;
            else {
                p.skills.fireball.level++;
                p.skills.fireball.damage += 16;
                p.skills.fireball.radius += 18;
            }
            break;
        case 'amaterasu':
            if (p.skills.amaterasu.level === 0) p.skills.amaterasu.level = 1;
            else {
                p.skills.amaterasu.level++;
                p.skills.amaterasu.count++;
                p.skills.amaterasu.damage += 12;
                p.skills.amaterasu.radius += 12;
            }
            break;
        case 'cherry_smash':
            if (p.skills.cherrySmash.level === 0) p.skills.cherrySmash.level = 1;
            else {
                p.skills.cherrySmash.level++;
                p.skills.cherrySmash.damage += 15;
                p.skills.cherrySmash.radius += 22;
            }
            break;
        case 'byakugou':
            if (p.skills.byakugou.level === 0) p.skills.byakugou.level = 1;
            else {
                p.skills.byakugou.level++;
                p.skills.byakugou.heal += 8;
                p.skills.byakugou.radius += 25;
            }
            break;
        case 'shadow_bind':
            if (p.skills.shadowBind.level === 0) p.skills.shadowBind.level = 1;
            else {
                p.skills.shadowBind.level++;
                p.skills.shadowBind.radius += 24;
                p.skills.shadowBind.damage += 6;
            }
            break;
        case 'shadow_stitch':
            if (p.skills.shadowStitch.level === 0) p.skills.shadowStitch.level = 1;
            else {
                p.skills.shadowStitch.level++;
                p.skills.shadowStitch.spikes++;
                p.skills.shadowStitch.damage += 10;
            }
            break;
        case 'hiraishin':
            if (p.skills.hiraishin.level === 0) p.skills.hiraishin.level = 1;
            else {
                p.skills.hiraishin.level++;
                p.skills.hiraishin.strikes++;
                p.skills.hiraishin.damage += 14;
            }
            break;
        case 'water_dragon':
            if (p.skills.waterDragon.level === 0) p.skills.waterDragon.level = 1;
            else {
                p.skills.waterDragon.level++;
                p.skills.waterDragon.count++;
                p.skills.waterDragon.damage += 20;
            }
            break;
        case 'deep_forest':
            if (p.skills.deepForest.level === 0) p.skills.deepForest.level = 1;
            else {
                p.skills.deepForest.level++;
                p.skills.deepForest.radius += 28;
                p.skills.deepForest.damage += 9;
            }
            break;
        case 'shinsu_senju':
            if (p.skills.shinsuSenju.level === 0) p.skills.shinsuSenju.level = 1;
            else {
                p.skills.shinsuSenju.level++;
                p.skills.shinsuSenju.fists += 2;
                p.skills.shinsuSenju.damage += 18;
            }
            break;
        case 'clone':
            if (p.skills.clones < 2) p.skills.clones++;
            break;
        case 'hp':
            p.maxHp += (p.charId === 'hashirama' ? 50 : 30);
            if (p.charId === 'hashirama') p.regen += 1.5;
            p.hp = Math.min(p.maxHp, p.hp + 80);
            break;
        case 'speed':
            p.speed *= 1.15;
            break;
        case 'magnet':
            p.pickupRange *= 1.5;
            break;
    }
}

function damageEnemy(room, enemy, amount, attacker, color = '#fde047', knockbackForce = 70) {
    if (enemy.hp <= 0) return;
    enemy.hp -= amount;
    enemy.hitTimer = 0.11;

    io.to(room.code).emit('fx', {
        type: 'dmg',
        x: Math.round(enemy.x),
        y: Math.round(enemy.y - enemy.radius - 8),
        val: Math.floor(amount),
        color
    });

    if (attacker && knockbackForce > 0) {
        const angle = Math.atan2(enemy.y - attacker.y, enemy.x - attacker.x);
        const kb = enemy.isBoss ? 0.08 : (enemy.type === 'elite' ? 0.3 : 1.0);
        enemy.kbVx = Math.cos(angle) * knockbackForce * kb;
        enemy.kbVy = Math.sin(angle) * knockbackForce * kb;
    }

    if (enemy.hp <= 0) {
        room.totalKills++;
        if (attacker) attacker.kills++;
        if (enemy.isBoss) {
            // Boss 擊破掉落大量經驗結晶與全場提示
            for (let k = 0; k < 10; k++) {
                const a = (Math.PI * 2 / 10) * k;
                room.gems.push({
                    id: room.nextEntityId++,
                    x: enemy.x + Math.cos(a) * 35,
                    y: enemy.y + Math.sin(a) * 35,
                    value: Math.ceil(enemy.xpValue / 10)
                });
            }
            io.to(room.code).emit('bossAlert', `★ 強敵「${enemy.bossName}」已被擊破！ ★`);
        } else {
            room.gems.push({
                id: room.nextEntityId++,
                x: enemy.x,
                y: enemy.y,
                value: enemy.xpValue
            });
        }
        io.to(room.code).emit('fx', {
            type: 'poof',
            x: Math.round(enemy.x),
            y: Math.round(enemy.y)
        });
    }
}

function hurtPlayer(room, p, dmg) {
    if (p.hitTimer > 0 || p.downed) return;
    p.hp = Math.max(0, p.hp - dmg);
    p.hitTimer = 0.55;
    io.to(p.id).emit('playerHurt');
    if (p.hp <= 0) {
        p.downed = true;
        p.reviveProgress = 0;
        if (room.players.size > 1) {
            io.to(room.code).emit('fx', { type: 'downed', x: Math.round(p.x), y: Math.round(p.y), name: p.name });
        }
    }
}

function stepRoom(room, dt) {
    if (room.state !== 'PLAYING') return;
    room.gameTime += dt;

    const players = Array.from(room.players.values());
    if (players.length === 0) return;

    const alivePlayers = players.filter(p => !p.downed);
    if (alivePlayers.length === 0) {
        room.state = 'GAMEOVER';
        const rankedPlayers = players
            .map(p => ({
                id: p.id,
                name: p.name,
                charId: p.charId,
                kills: p.kills
            }))
            .sort((a, b) => b.kills - a.kills);

        const entryId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const mvp = rankedPlayers[0];
        const newEntry = {
            entryId,
            name: mvp ? mvp.name : '木葉忍者',
            charId: mvp ? mvp.charId : 'naruto',
            teamNames: rankedPlayers.map(p => p.name).join(' / '),
            modeLabel: rankedPlayers.length > 1 ? `${rankedPlayers.length}人合作` : '單機挑戰',
            time: Math.floor(room.gameTime),
            level: room.teamLevel,
            kills: room.totalKills
        };
        const updatedGlobal = recordGlobalScore(newEntry);

        io.to(room.code).emit('gameOver', {
            entryId,
            time: room.gameTime,
            level: room.teamLevel,
            totalKills: room.totalKills,
            players: rankedPlayers,
            globalLeaderboard: updatedGlobal
        });
        return;
    }

    // 檢查定時原著強敵 Boss 生成 (5:00 我愛羅 / 10:00 大蛇丸 / 15:00 鼬 / 30:00 佩恩)
    for (const bCfg of BOSS_SCHEDULE) {
        if (room.gameTime >= bCfg.time && !room.spawnedBosses.has(bCfg.type)) {
            room.spawnedBosses.add(bCfg.type);
            const anchor = alivePlayers[0];
            const ang = Math.random() * Math.PI * 2;
            const hpScale = 1 + (players.length - 1) * 0.65;
            const bossHp = Math.round(bCfg.baseHp * hpScale);

            room.enemies.push({
                id: room.nextEntityId++,
                type: bCfg.type,
                isBoss: true,
                bossName: bCfg.name,
                x: anchor.x + Math.cos(ang) * 520,
                y: anchor.y + Math.sin(ang) * 520,
                vx: 0,
                vy: 0,
                kbVx: 0,
                kbVy: 0,
                facing: 'left',
                hp: bossHp,
                maxHp: bossHp,
                speed: bCfg.speed,
                damage: bCfg.damage,
                radius: bCfg.radius,
                xpValue: bCfg.xp,
                hitTimer: 0,
                slowTimer: 0,
                slowFactor: 0.72,
                skillTimer1: 2.2,
                skillTimer2: 4.5,
                skillCycle: 0
            });
            io.to(room.code).emit('bossAlert', `⚠️ 強敵來襲：「${bCfg.name}」出現！`);
            io.to(room.code).emit('sfx', 'rasengan');
        }
    }

    // 1. 更新玩家移動與忍術施放
    for (const p of players) {
        if (p.hitTimer > 0) p.hitTimer = Math.max(0, p.hitTimer - dt);

        if (p.downed) {
            p.vx = 0;
            p.vy = 0;
            let rescuerNearby = false;
            for (const ally of alivePlayers) {
                if (Math.hypot(ally.x - p.x, ally.y - p.y) <= 68) {
                    rescuerNearby = true;
                    break;
                }
            }
            if (rescuerNearby) {
                p.reviveProgress += dt / 3.0;
                if (p.reviveProgress >= 1) {
                    p.downed = false;
                    p.reviveProgress = 0;
                    p.hp = Math.round(p.maxHp * 0.5);
                    p.hitTimer = 1.5;
                    io.to(room.code).emit('fx', { type: 'revive', x: Math.round(p.x), y: Math.round(p.y), name: p.name });
                }
            } else {
                p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.35);
            }
            continue;
        }

        if (p.regen > 0 && p.hp < p.maxHp) {
            p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
        }

        if (p.dx !== 0 || p.dy !== 0) {
            const len = Math.hypot(p.dx, p.dy);
            const scale = len > 1 ? 1 / len : 1;
            p.vx = p.dx * scale * p.speed;
            p.vy = p.dy * scale * p.speed;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.dx < -0.05) p.facing = 'left';
            if (p.dx > 0.05) p.facing = 'right';
        } else {
            p.vx = 0;
            p.vy = 0;
        }

        // 主武器自動發射
        p.weapon.timer -= dt;
        if (p.weapon.timer <= 0 && room.enemies.length > 0) {
            let nearest = null;
            let minDist = Infinity;
            for (const e of room.enemies) {
                const d = Math.hypot(e.x - p.x, e.y - p.y);
                if (d < minDist) {
                    minDist = d;
                    nearest = e;
                }
            }
            if (nearest && minDist < 840) {
                const baseAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
                p.facing = Math.cos(baseAngle) >= 0 ? 'right' : 'left';
                const cnt = p.weapon.count;
                const spreadStep = p.charId === 'jiraiya' ? 0.14 : 0.16;
                const projSpeed = p.charId === 'minato' ? 840
                    : p.charId === 'tobirama' ? 880
                        : p.charId === 'hashirama' ? 660
                            : p.charId === 'sasuke' ? 760 : 690;
                const isPiercing = (p.weapon.type === 'water_sever' || p.weapon.type === 'wood_dragon');

                for (let i = 0; i < cnt; i++) {
                    const angle = baseAngle + (i - (cnt - 1) / 2) * spreadStep;
                    room.projectiles.push({
                        id: room.nextEntityId++,
                        ownerId: p.id,
                        kind: p.weapon.type,
                        x: p.x,
                        y: p.y,
                        vx: Math.cos(angle) * projSpeed,
                        vy: Math.sin(angle) * projSpeed,
                        angle,
                        damage: p.weapon.damage,
                        radius: isPiercing ? 16 : 10,
                        pierce: isPiercing ? 4 : 1,
                        hitIds: new Set(),
                        life: 1.6
                    });
                }
                io.to(room.code).emit('sfx', 'kunai');
                p.weapon.timer = p.weapon.cooldown;
            }
        }

        // 鳴人影分身
        if (p.skills.clones > 0 && room.enemies.length > 0) {
            for (let c = 0; c < p.skills.clones; c++) {
                p.skills.cloneTimers[c] -= dt;
                if (p.skills.cloneTimers[c] <= 0) {
                    const offsetX = c === 0 ? -50 : 50;
                    const offsetY = c === 0 ? -22 : 22;
                    const cx = p.x + offsetX;
                    const cy = p.y + offsetY;
                    let nearest = null, minD = Infinity;
                    for (const e of room.enemies) {
                        const d = Math.hypot(e.x - cx, e.y - cy);
                        if (d < minD) { minD = d; nearest = e; }
                    }
                    if (nearest && minD < 750) {
                        const ang = Math.atan2(nearest.y - cy, nearest.x - cx);
                        room.projectiles.push({
                            id: room.nextEntityId++,
                            ownerId: p.id,
                            kind: 'shuriken',
                            x: cx,
                            y: cy,
                            vx: Math.cos(ang) * 680,
                            vy: Math.sin(ang) * 680,
                            angle: ang,
                            damage: Math.ceil(p.weapon.damage * 0.65),
                            radius: 9,
                            pierce: 1,
                            hitIds: new Set(),
                            life: 1.5
                        });
                    }
                    p.skills.cloneTimers[c] = p.weapon.cooldown * 1.15;
                }
            }
        }

        // 螺旋丸領域
        if (p.skills.rasengan.level > 0) {
            p.skills.rasengan.timer -= dt;
            if (p.skills.rasengan.timer <= 0) {
                p.skills.rasengan.timer = p.skills.rasengan.cooldown;
                const r = p.skills.rasengan.radius;
                io.to(room.code).emit('fx', { type: 'rasengan', x: Math.round(p.x), y: Math.round(p.y), r });
                io.to(room.code).emit('sfx', 'rasengan');
                for (const e of room.enemies) {
                    if (Math.hypot(e.x - p.x, e.y - p.y) < r + e.radius) {
                        damageEnemy(room, e, p.skills.rasengan.damage, p, '#38bdf8');
                        e.slowTimer = 1.1;
                        e.slowFactor = 0.48;
                    }
                }
            }
        }

        // 雷切球 / 佐助千鳥流
        if (p.skills.raikiri.level > 0) {
            const rk = p.skills.raikiri;
            const time = room.gameTime * rk.speed;
            for (let i = 0; i < rk.count; i++) {
                const ang = time + ((Math.PI * 2) / rk.count) * i;
                const sx = p.x + Math.cos(ang) * rk.radius;
                const sy = p.y + Math.sin(ang) * rk.radius;
                for (const e of room.enemies) {
                    if (e.hitTimer > 0) continue;
                    if (Math.hypot(e.x - sx, e.y - sy) < 16 + e.radius) {
                        damageEnemy(room, e, rk.damage, p, '#7dd3fc', 280);
                    }
                }
            }
        }

        // 卡卡西連鎖紫電
        if (p.skills.lightning.level > 0 && room.enemies.length > 0) {
            p.skills.lightning.timer -= dt;
            if (p.skills.lightning.timer <= 0) {
                p.skills.lightning.timer = p.skills.lightning.cooldown;
                const candidates = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 440)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, p.skills.lightning.bolts);

                if (candidates.length > 0) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const target of candidates) {
                        io.to(room.code).emit('fx', {
                            type: 'lightning',
                            x1: Math.round(p.x),
                            y1: Math.round(p.y - 12),
                            x2: Math.round(target.x),
                            y2: Math.round(target.y)
                        });
                        damageEnemy(room, target, p.skills.lightning.damage, p, '#c084fc');
                    }
                }
            }
        }

        // 自來也大炎彈
        if (p.skills.fireball.level > 0 && room.enemies.length > 0) {
            p.skills.fireball.timer -= dt;
            if (p.skills.fireball.timer <= 0) {
                p.skills.fireball.timer = p.skills.fireball.cooldown;
                let nearest = null, minD = Infinity;
                for (const e of room.enemies) {
                    const d = Math.hypot(e.x - p.x, e.y - p.y);
                    if (d < minD) { minD = d; nearest = e; }
                }
                if (nearest && minD < 720) {
                    const ang = Math.atan2(nearest.y - p.y, nearest.x - p.x);
                    room.projectiles.push({
                        id: room.nextEntityId++,
                        ownerId: p.id,
                        kind: 'fireball',
                        x: p.x,
                        y: p.y,
                        vx: Math.cos(ang) * 440,
                        vy: Math.sin(ang) * 440,
                        angle: ang,
                        damage: p.skills.fireball.damage,
                        blastRadius: p.skills.fireball.radius,
                        radius: 15,
                        pierce: 1,
                        hitIds: new Set(),
                        life: 2.0
                    });
                    io.to(room.code).emit('sfx', 'kunai');
                }
            }
        }

        // 佐助天照
        if (p.skills.amaterasu.level > 0 && room.enemies.length > 0) {
            p.skills.amaterasu.timer -= dt;
            if (p.skills.amaterasu.timer <= 0) {
                p.skills.amaterasu.timer = p.skills.amaterasu.cooldown;
                const targets = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 450)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, p.skills.amaterasu.count);

                if (targets.length > 0) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const t of targets) {
                        const r = p.skills.amaterasu.radius;
                        io.to(room.code).emit('fx', { type: 'amaterasu', x: Math.round(t.x), y: Math.round(t.y), r });
                        for (const e of room.enemies) {
                            if (Math.hypot(e.x - t.x, e.y - t.y) <= r + e.radius) {
                                damageEnemy(room, e, p.skills.amaterasu.damage, p, '#a855f7', 35);
                            }
                        }
                    }
                }
            }
        }

        // 小櫻櫻花衝
        if (p.skills.cherrySmash.level > 0) {
            p.skills.cherrySmash.timer -= dt;
            if (p.skills.cherrySmash.timer <= 0) {
                p.skills.cherrySmash.timer = p.skills.cherrySmash.cooldown;
                const r = p.skills.cherrySmash.radius;
                io.to(room.code).emit('fx', { type: 'smash', x: Math.round(p.x), y: Math.round(p.y), r });
                io.to(room.code).emit('sfx', 'rasengan');
                for (const e of room.enemies) {
                    if (Math.hypot(e.x - p.x, e.y - p.y) <= r + e.radius) {
                        damageEnemy(room, e, p.skills.cherrySmash.damage, p, '#f472b6', 380);
                    }
                }
            }
        }

        // 小櫻百豪之印
        if (p.skills.byakugou.level > 0) {
            p.skills.byakugou.timer -= dt;
            if (p.skills.byakugou.timer <= 0) {
                p.skills.byakugou.timer = p.skills.byakugou.cooldown;
                const r = p.skills.byakugou.radius;
                const healAmt = p.skills.byakugou.heal;
                io.to(room.code).emit('fx', { type: 'heal', x: Math.round(p.x), y: Math.round(p.y), r });
                io.to(room.code).emit('sfx', 'gem');
                for (const ally of alivePlayers) {
                    if (Math.hypot(ally.x - p.x, ally.y - p.y) <= r) {
                        ally.hp = Math.min(ally.maxHp, ally.hp + healAmt);
                        io.to(room.code).emit('fx', {
                            type: 'dmg',
                            x: Math.round(ally.x),
                            y: Math.round(ally.y - 45),
                            val: `+${healAmt}`,
                            color: '#4ade80'
                        });
                    }
                }
            }
        }

        // 鹿丸影子模仿術
        if (p.skills.shadowBind.level > 0) {
            p.skills.shadowBind.timer -= dt;
            if (p.skills.shadowBind.timer <= 0) {
                p.skills.shadowBind.timer = p.skills.shadowBind.cooldown;
                const r = p.skills.shadowBind.radius;
                for (const e of room.enemies) {
                    if (Math.hypot(e.x - p.x, e.y - p.y) <= r + e.radius) {
                        damageEnemy(room, e, p.skills.shadowBind.damage, p, '#94a3b8', 15);
                        e.slowTimer = 1.2;
                        e.slowFactor = 0.30;
                    }
                }
            }
        }

        // 鹿丸影子縫合術
        if (p.skills.shadowStitch.level > 0 && room.enemies.length > 0) {
            p.skills.shadowStitch.timer -= dt;
            if (p.skills.shadowStitch.timer <= 0) {
                p.skills.shadowStitch.timer = p.skills.shadowStitch.cooldown;
                const targets = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 400)
                    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
                    .slice(0, p.skills.shadowStitch.spikes);

                if (targets.length > 0) {
                    io.to(room.code).emit('sfx', 'hit');
                    for (const t of targets) {
                        io.to(room.code).emit('fx', {
                            type: 'shadowStitch',
                            x1: Math.round(p.x),
                            y1: Math.round(p.y + 18),
                            x2: Math.round(t.x),
                            y2: Math.round(t.y + 10)
                        });
                        damageEnemy(room, t, p.skills.shadowStitch.damage, p, '#cbd5e1', 50);
                        t.slowTimer = 1.0;
                        t.slowFactor = 0.35;
                    }
                }
            }
        }

        // 水門 / 扉間 飛雷神斬
        if (p.skills.hiraishin.level > 0 && room.enemies.length > 0) {
            p.skills.hiraishin.timer -= dt;
            if (p.skills.hiraishin.timer <= 0) {
                p.skills.hiraishin.timer = p.skills.hiraishin.cooldown;
                const targets = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 480)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, p.skills.hiraishin.strikes);

                if (targets.length > 0) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    let prevX = p.x, prevY = p.y;
                    const isTobirama = p.charId === 'tobirama';
                    for (const t of targets) {
                        io.to(room.code).emit('fx', {
                            type: isTobirama ? 'waterSlash' : 'hiraishin',
                            x1: Math.round(prevX),
                            y1: Math.round(prevY),
                            x2: Math.round(t.x),
                            y2: Math.round(t.y)
                        });
                        damageEnemy(room, t, p.skills.hiraishin.damage, p, isTobirama ? '#38bdf8' : '#facc15', 60);
                        prevX = t.x;
                        prevY = t.y;
                    }
                }
            }
        }

        // 扉間：水遁・水龍彈之術
        if (p.skills.waterDragon.level > 0 && room.enemies.length > 0) {
            p.skills.waterDragon.timer -= dt;
            if (p.skills.waterDragon.timer <= 0) {
                p.skills.waterDragon.timer = p.skills.waterDragon.cooldown;
                const targets = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 650)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, p.skills.waterDragon.count);

                if (targets.length > 0) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const t of targets) {
                        const ang = Math.atan2(t.y - p.y, t.x - p.x);
                        room.projectiles.push({
                            id: room.nextEntityId++,
                            ownerId: p.id,
                            kind: 'water_dragon_proj',
                            x: p.x,
                            y: p.y,
                            vx: Math.cos(ang) * 520,
                            vy: Math.sin(ang) * 520,
                            angle: ang,
                            damage: p.skills.waterDragon.damage,
                            blastRadius: p.skills.waterDragon.radius,
                            radius: 18,
                            pierce: 1,
                            hitIds: new Set(),
                            life: 1.8
                        });
                    }
                }
            }
        }

        // 柱間：木遁・樹界降誕（腳下巨樹藤蔓領域）
        if (p.skills.deepForest.level > 0) {
            p.skills.deepForest.timer -= dt;
            if (p.skills.deepForest.timer <= 0) {
                p.skills.deepForest.timer = p.skills.deepForest.cooldown;
                const r = p.skills.deepForest.radius;
                for (const e of room.enemies) {
                    if (Math.hypot(e.x - p.x, e.y - p.y) <= r + e.radius) {
                        damageEnemy(room, e, p.skills.deepForest.damage, p, '#4ade80', 25);
                        e.slowTimer = 1.3;
                        e.slowFactor = 0.35;
                    }
                }
            }
        }

        // 柱間：仙法・木遁・真數千手（漫天金色巨拳連轟）
        if (p.skills.shinsuSenju.level > 0 && room.enemies.length > 0) {
            p.skills.shinsuSenju.timer -= dt;
            if (p.skills.shinsuSenju.timer <= 0) {
                p.skills.shinsuSenju.timer = p.skills.shinsuSenju.cooldown;
                const targets = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 520)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, p.skills.shinsuSenju.fists);

                if (targets.length > 0) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const t of targets) {
                        io.to(room.code).emit('fx', {
                            type: 'buddhaFist',
                            x: Math.round(t.x),
                            y: Math.round(t.y),
                            r: 48
                        });
                        for (const e of room.enemies) {
                            if (Math.hypot(e.x - t.x, e.y - t.y) <= 48 + e.radius) {
                                damageEnemy(room, e, p.skills.shinsuSenju.damage, p, '#fde047', 140);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 普通敵人波次生成
    room.spawnTimer -= dt;
    if (room.spawnTimer <= 0 && room.enemies.length < 150) {
        const playerScale = 1 + (players.length - 1) * 0.55;
        const spawnRate = Math.max(0.22, (0.95 - room.gameTime / 280) / playerScale);
        const spawnCount = Math.max(1, Math.floor((1 + room.gameTime / 45) * (1 + (players.length - 1) * 0.35)));
        const hpMult = (1 + room.gameTime / 110) * (1 + (players.length - 1) * 0.25);

        for (let i = 0; i < spawnCount; i++) {
            const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            const angle = Math.random() * Math.PI * 2;
            const dist = 840 + Math.random() * 140;
            const rand = Math.random();
            let type = 'basic';
            if (room.gameTime > 18 && rand < 0.28) type = 'fast';
            if (room.gameTime > 42 && rand > 0.88) type = 'elite';

            const stats = type === 'basic'
                ? { radius: 21, speed: 92, hp: Math.round(30 * hpMult), damage: 11, xp: 3 }
                : type === 'fast'
                    ? { radius: 19, speed: 170, hp: Math.round(18 * hpMult), damage: 8, xp: 4 }
                    : { radius: 29, speed: 60, hp: Math.round(170 * hpMult), damage: 24, xp: 14 };

            room.enemies.push({
                id: room.nextEntityId++,
                type,
                isBoss: false,
                x: anchor.x + Math.cos(angle) * dist,
                y: anchor.y + Math.sin(angle) * dist,
                vx: 0,
                vy: 0,
                kbVx: 0,
                kbVy: 0,
                facing: 'left',
                hp: stats.hp,
                maxHp: stats.hp,
                speed: stats.speed,
                damage: stats.damage,
                radius: stats.radius,
                xpValue: stats.xp,
                hitTimer: 0,
                slowTimer: 0,
                slowFactor: 0.48
            });
        }
        room.spawnTimer = spawnRate;
    }

    // 3. 更新玩家投射物與碰撞
    for (let i = room.projectiles.length - 1; i >= 0; i--) {
        const proj = room.projectiles[i];
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        proj.life -= dt;
        if (proj.life <= 0) {
            room.projectiles.splice(i, 1);
            continue;
        }

        const owner = room.players.get(proj.ownerId);
        for (let j = room.enemies.length - 1; j >= 0; j--) {
            const e = room.enemies[j];
            if (proj.hitIds && proj.hitIds.has(e.id)) continue;

            if (Math.hypot(proj.x - e.x, proj.y - e.y) < proj.radius + e.radius) {
                if (proj.kind === 'fireball' || proj.kind === 'water_dragon_proj') {
                    const isWater = proj.kind === 'water_dragon_proj';
                    io.to(room.code).emit('fx', {
                        type: isWater ? 'waterBlast' : 'explosion',
                        x: Math.round(proj.x),
                        y: Math.round(proj.y),
                        r: proj.blastRadius
                    });
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const target of room.enemies) {
                        if (Math.hypot(target.x - proj.x, target.y - proj.y) <= proj.blastRadius + target.radius) {
                            damageEnemy(room, target, proj.damage, owner, isWater ? '#38bdf8' : '#fb923c', isWater ? 200 : 90);
                        }
                    }
                    room.projectiles.splice(i, 1);
                    break;
                } else {
                    damageEnemy(room, e, proj.damage, owner, proj.kind === 'water_sever' ? '#38bdf8' : proj.kind === 'wood_dragon' ? '#4ade80' : '#fde047');
                    if (proj.hitIds) proj.hitIds.add(e.id);
                    proj.pierce = (proj.pierce || 1) - 1;
                    if (proj.pierce <= 0) {
                        room.projectiles.splice(i, 1);
                        break;
                    }
                }
            }
        }
    }

    // 4. 更新敵人與 Boss 專屬原著技能 AI
    for (let i = room.enemies.length - 1; i >= 0; i--) {
        const e = room.enemies[i];
        if (e.hp <= 0) {
            room.enemies.splice(i, 1);
            continue;
        }
        if (e.hitTimer > 0) e.hitTimer = Math.max(0, e.hitTimer - dt);
        if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);

        let target = alivePlayers[0];
        let minD = Infinity;
        for (const p of alivePlayers) {
            const d = Math.hypot(p.x - e.x, p.y - e.y);
            if (d < minD) { minD = d; target = p; }
        }

        const spd = e.slowTimer > 0 ? e.speed * (e.slowFactor || 0.48) : e.speed;
        e.kbVx *= 0.88;
        e.kbVy *= 0.88;

        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.facing = Math.cos(angle) >= 0 ? 'right' : 'left';
        e.vx = Math.cos(angle) * spd + e.kbVx;
        e.vy = Math.sin(angle) * spd + e.kbVy;
        e.x += e.vx * dt;
        e.y += e.vy * dt;

        // Boss 專屬原著忍術循環
        if (e.isBoss && minD < 950) {
            e.skillTimer1 -= dt;
            e.skillTimer2 -= dt;

            if (e.type === 'gaara') {
                // 我愛羅技能 1：砂手裏劍 5 連射
                if (e.skillTimer1 <= 0) {
                    e.skillTimer1 = 2.6;
                    for (let k = -2; k <= 2; k++) {
                        const a = angle + k * 0.22;
                        room.enemyProjectiles.push({
                            id: room.nextEntityId++,
                            kind: 'sand_shuriken',
                            x: e.x,
                            y: e.y,
                            vx: Math.cos(a) * 320,
                            vy: Math.sin(a) * 320,
                            angle: a,
                            damage: 18,
                            radius: 10,
                            life: 2.8
                        });
                    }
                }
                // 我愛羅技能 2：砂縛柩・砂瀑送葬（地面預警圈 -> 1.1秒後砂柱爆發）
                if (e.skillTimer2 <= 0) {
                    e.skillTimer2 = 4.2;
                    for (const p of alivePlayers) {
                        room.hazardZones.push({
                            id: room.nextEntityId++,
                            kind: 'sand_coffin',
                            x: Math.round(p.x),
                            y: Math.round(p.y),
                            r: 72,
                            delay: 1.1,
                            damage: 28
                        });
                    }
                }
            } else if (e.type === 'orochimaru') {
                // 大蛇丸技能 1：潛影多蛇手（7 條毒蛇扇形突襲）
                if (e.skillTimer1 <= 0) {
                    e.skillTimer1 = 2.5;
                    for (let k = -3; k <= 3; k++) {
                        const a = angle + k * 0.18;
                        room.enemyProjectiles.push({
                            id: room.nextEntityId++,
                            kind: 'snake',
                            x: e.x,
                            y: e.y,
                            vx: Math.cos(a) * 350,
                            vy: Math.sin(a) * 350,
                            angle: a,
                            damage: 22,
                            radius: 10,
                            life: 2.8
                        });
                    }
                }
                // 大蛇丸技能 2：草薙劍・空之太刀 + 召喚部下
                if (e.skillTimer2 <= 0) {
                    e.skillTimer2 = 5.0;
                    room.enemyProjectiles.push({
                        id: room.nextEntityId++,
                        kind: 'kusanagi',
                        x: e.x,
                        y: e.y,
                        vx: Math.cos(angle) * 520,
                        vy: Math.sin(angle) * 520,
                        angle,
                        damage: 34,
                        radius: 16,
                        life: 2.4
                    });
                    for (let s = 0; s < 3; s++) {
                        const sa = angle + (s - 1) * 1.2;
                        room.enemies.push({
                            id: room.nextEntityId++,
                            type: 'fast',
                            isBoss: false,
                            x: e.x + Math.cos(sa) * 55,
                            y: e.y + Math.sin(sa) * 55,
                            vx: 0, vy: 0, kbVx: 0, kbVy: 0,
                            facing: e.facing,
                            hp: 120, maxHp: 120, speed: 175, damage: 14, radius: 19, xpValue: 5,
                            hitTimer: 0, slowTimer: 0, slowFactor: 0.48
                        });
                    }
                }
            } else if (e.type === 'itachi') {
                // 宇智波鼬技能 1：魔幻・烏鴉分身 10 方向散射
                if (e.skillTimer1 <= 0) {
                    e.skillTimer1 = 2.4;
                    for (let k = 0; k < 10; k++) {
                        const a = (Math.PI * 2 / 10) * k + room.gameTime;
                        room.enemyProjectiles.push({
                            id: room.nextEntityId++,
                            kind: 'crow',
                            x: e.x,
                            y: e.y,
                            vx: Math.cos(a) * 360,
                            vy: Math.sin(a) * 360,
                            angle: a,
                            damage: 24,
                            radius: 10,
                            life: 2.6
                        });
                    }
                }
                // 宇智波鼬技能 2：天照黑炎陷阱 + 須佐能乎十拳劍氣
                if (e.skillTimer2 <= 0) {
                    e.skillTimer2 = 4.2;
                    for (const p of alivePlayers) {
                        room.hazardZones.push({
                            id: room.nextEntityId++,
                            kind: 'boss_amaterasu',
                            x: Math.round(p.x + (Math.random() - 0.5) * 60),
                            y: Math.round(p.y + (Math.random() - 0.5) * 60),
                            r: 78,
                            delay: 1.0,
                            damage: 34
                        });
                    }
                    room.enemyProjectiles.push({
                        id: room.nextEntityId++,
                        kind: 'susanoo_wave',
                        x: e.x,
                        y: e.y,
                        vx: Math.cos(angle) * 480,
                        vy: Math.sin(angle) * 480,
                        angle,
                        damage: 38,
                        radius: 22,
                        life: 2.4
                    });
                }
            } else if (e.type === 'pain') {
                // 佩恩（長門）多樣化六道能力循環
                if (e.skillTimer1 <= 0) {
                    e.skillTimer1 = 2.2;
                    // 修羅道：8 方向查克拉導彈齊射
                    for (let k = 0; k < 8; k++) {
                        const a = (Math.PI * 2 / 8) * k + e.skillCycle * 0.4;
                        room.enemyProjectiles.push({
                            id: room.nextEntityId++,
                            kind: 'asura_missile',
                            x: e.x,
                            y: e.y,
                            vx: Math.cos(a) * 370,
                            vy: Math.sin(a) * 370,
                            angle: a,
                            damage: 28,
                            radius: 11,
                            life: 2.8
                        });
                    }
                }
                if (e.skillTimer2 <= 0) {
                    e.skillTimer2 = 4.0;
                    e.skillCycle = (e.skillCycle + 1) % 3;
                    if (e.skillCycle === 0) {
                        // 神羅天征（大範圍斥力震飛）
                        room.hazardZones.push({
                            id: room.nextEntityId++,
                            kind: 'shinra_tensei',
                            x: Math.round(e.x),
                            y: Math.round(e.y),
                            r: 230,
                            delay: 1.0,
                            damage: 42
                        });
                    } else if (e.skillCycle === 1) {
                        // 萬象天引（將附近玩家拉向佩恩）
                        io.to(room.code).emit('fx', { type: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 360 });
                        for (const p of alivePlayers) {
                            const d = Math.hypot(e.x - p.x, e.y - p.y);
                            if (d > 70 && d < 480) {
                                const pullAng = Math.atan2(e.y - p.y, e.x - p.x);
                                p.x += Math.cos(pullAng) * 140;
                                p.y += Math.sin(pullAng) * 140;
                            }
                        }
                    } else {
                        // 地爆天星（巨型引力黑球）
                        room.enemyProjectiles.push({
                            id: room.nextEntityId++,
                            kind: 'chibaku',
                            x: e.x,
                            y: e.y,
                            vx: Math.cos(angle) * 230,
                            vy: Math.sin(angle) * 230,
                            angle,
                            damage: 48,
                            radius: 28,
                            life: 3.5
                        });
                    }
                }
            }
        }

        // 近戰碰撞傷害
        for (const p of alivePlayers) {
            if (p.hitTimer > 0 || p.downed) continue;
            if (Math.hypot(p.x - e.x, p.y - e.y) < p.radius + e.radius - 4) {
                hurtPlayer(room, p, e.damage);
            }
        }
    }

    // 5. 更新 Boss 投射物與地面預警陷阱
    for (let i = room.enemyProjectiles.length - 1; i >= 0; i--) {
        const ep = room.enemyProjectiles[i];
        ep.x += ep.vx * dt;
        ep.y += ep.vy * dt;
        ep.life -= dt;
        if (ep.life <= 0) {
            room.enemyProjectiles.splice(i, 1);
            continue;
        }
        for (const p of alivePlayers) {
            if (Math.hypot(p.x - ep.x, p.y - ep.y) < p.radius + ep.radius) {
                hurtPlayer(room, p, ep.damage);
                if (ep.kind !== 'kusanagi' && ep.kind !== 'susanoo_wave') {
                    room.enemyProjectiles.splice(i, 1);
                }
                break;
            }
        }
    }

    for (let i = room.hazardZones.length - 1; i >= 0; i--) {
        const hz = room.hazardZones[i];
        hz.delay -= dt;
        if (hz.delay <= 0) {
            io.to(room.code).emit('fx', {
                type: hz.kind,
                x: hz.x,
                y: hz.y,
                r: hz.r
            });
            io.to(room.code).emit('sfx', 'rasengan');
            for (const p of alivePlayers) {
                const d = Math.hypot(p.x - hz.x, p.y - hz.y);
                if (d <= hz.r + p.radius) {
                    hurtPlayer(room, p, hz.damage);
                    if (hz.kind === 'shinra_tensei') {
                        const pushAng = Math.atan2(p.y - hz.y, p.x - hz.x);
                        p.x += Math.cos(pushAng) * 180;
                        p.y += Math.sin(pushAng) * 180;
                    }
                }
            }
            room.hazardZones.splice(i, 1);
        }
    }

    // 6. 更新查克拉經驗寶石
    for (let i = room.gems.length - 1; i >= 0; i--) {
        const g = room.gems[i];
        let collector = null;
        let minD = Infinity;

        for (const p of alivePlayers) {
            const d = Math.hypot(p.x - g.x, p.y - g.y);
            if (d < p.pickupRange && d < minD) {
                minD = d;
                collector = p;
            }
        }

        if (collector) {
            const ang = Math.atan2(collector.y - g.y, collector.x - g.x);
            g.x += Math.cos(ang) * 490 * dt;
            g.y += Math.sin(ang) * 490 * dt;

            if (Math.hypot(collector.x - g.x, collector.y - g.y) < collector.radius + 14) {
                room.teamXp += g.value;
                room.gems.splice(i, 1);
                io.to(room.code).emit('sfx', 'gem');
                if (room.teamXp >= room.teamXpNext && room.state === 'PLAYING') {
                    triggerTeamLevelUp(room);
                    break;
                }
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
                t: room.gameTime,
                lv: room.teamLevel,
                xp: room.teamXp,
                xpNext: room.teamXpNext,
                kills: room.totalKills,
                players: Array.from(room.players.values()).map(p => ({
                    id: p.id,
                    name: p.name,
                    charId: p.charId,
                    x: Math.round(p.x),
                    y: Math.round(p.y),
                    vx: Math.round(p.vx),
                    vy: Math.round(p.vy),
                    spd: Math.round(p.speed),
                    facing: p.facing,
                    moving: p.dx !== 0 || p.dy !== 0,
                    hp: p.hp,
                    maxHp: p.maxHp,
                    kills: p.kills,
                    hit: p.hitTimer > 0.35,
                    downed: p.downed,
                    revive: Number(p.reviveProgress.toFixed(2)),
                    wCount: p.weapon.count,
                    rasenLv: p.skills.rasengan.level,
                    rasenR: p.skills.rasengan.radius,
                    raikiriLv: p.skills.raikiri.level,
                    raikiriCnt: p.skills.raikiri.count,
                    raikiriR: p.skills.raikiri.radius,
                    raikiriSpd: p.skills.raikiri.speed,
                    lightLv: p.skills.lightning.level,
                    fireLv: p.skills.fireball.level,
                    amatLv: p.skills.amaterasu.level,
                    smashLv: p.skills.cherrySmash.level,
                    healLv: p.skills.byakugou.level,
                    shadowLv: p.skills.shadowBind.level,
                    shadowR: p.skills.shadowBind.radius,
                    stitchLv: p.skills.shadowStitch.level,
                    hiraiLv: p.skills.hiraishin.level,
                    waterLv: p.skills.waterDragon.level,
                    forestLv: p.skills.deepForest.level,
                    forestR: p.skills.deepForest.radius,
                    senjuLv: p.skills.shinsuSenju.level,
                    clones: p.skills.clones
                })),
                enemies: room.enemies.map(e => ({
                    id: e.id,
                    type: e.type,
                    isBoss: !!e.isBoss,
                    bossName: e.bossName || '',
                    x: Math.round(e.x),
                    y: Math.round(e.y),
                    vx: Math.round(e.vx),
                    vy: Math.round(e.vy),
                    facing: e.facing,
                    hp: e.hp,
                    maxHp: e.maxHp,
                    hit: e.hitTimer > 0,
                    slow: e.slowTimer > 0
                })),
                projectiles: room.projectiles.map(pr => ({
                    id: pr.id,
                    kind: pr.kind,
                    x: Math.round(pr.x),
                    y: Math.round(pr.y),
                    vx: Math.round(pr.vx),
                    vy: Math.round(pr.vy),
                    angle: Number(pr.angle.toFixed(2))
                })),
                enemyProjectiles: room.enemyProjectiles.map(ep => ({
                    id: ep.id,
                    kind: ep.kind,
                    x: Math.round(ep.x),
                    y: Math.round(ep.y),
                    vx: Math.round(ep.vx),
                    vy: Math.round(ep.vy),
                    angle: Number(ep.angle.toFixed(2))
                })),
                hazardZones: room.hazardZones.map(hz => ({
                    id: hz.id,
                    kind: hz.kind,
                    x: hz.x,
                    y: hz.y,
                    r: hz.r,
                    delay: Number(hz.delay.toFixed(2))
                })),
                gems: room.gems.map(g => ({
                    id: g.id,
                    x: Math.round(g.x),
                    y: Math.round(g.y),
                    val: g.value
                }))
            });
        }
    }
}, 1000 / 30);

io.on('connection', (socket) => {
    let currentRoomCode = null;

    socket.emit('globalLeaderboardUpdate', globalLeaderboard);

    function removePlayerFromRoom() {
        if (!currentRoomCode) return;
        const code = currentRoomCode;
        currentRoomCode = null;
        socket.leave(code);

        const room = rooms.get(code);
        if (!room) return;
        room.players.delete(socket.id);

        if (room.players.size === 0) {
            rooms.delete(code);
            return;
        }
        if (room.hostId === socket.id) {
            room.hostId = Array.from(room.players.keys())[0];
        }
        if (room.state === 'LOBBY') {
            broadcastLobby(room);
        } else if (room.state === 'LEVELUP') {
            emitUpgradeStatus(room);
        }
    }

    socket.on('pingCheck', (cb) => {
        if (typeof cb === 'function') cb();
    });

    socket.on('submitSoloScore', (entry) => {
        if (!entry || typeof entry.time !== 'number') return;
        const updated = recordGlobalScore({
            entryId: entry.entryId || `${Date.now()}`,
            name: String(entry.name || '木葉忍者').slice(0, 12),
            charId: CHAR_CONFIG[entry.charId] ? entry.charId : 'naruto',
            teamNames: String(entry.name || '木葉忍者').slice(0, 12),
            modeLabel: '單機挑戰',
            time: Math.floor(entry.time),
            level: Math.max(1, Math.floor(entry.level || 1)),
            kills: Math.max(0, Math.floor(entry.kills || 0))
        });
        io.emit('globalLeaderboardUpdate', updated);
    });

    socket.on('createRoom', ({ name, charId }) => {
        removePlayerFromRoom();
        const code = generateRoomCode();
        const room = {
            code,
            hostId: socket.id,
            state: 'LOBBY',
            pausedBy: null,
            players: new Map(),
            enemies: [],
            projectiles: [],
            enemyProjectiles: [],
            hazardZones: [],
            gems: [],
            spawnedBosses: new Set(),
            gameTime: 0,
            teamLevel: 1,
            teamXp: 0,
            teamXpNext: 30,
            totalKills: 0,
            spawnTimer: 0,
            nextEntityId: 1
        };
        const safeChar = CHAR_CONFIG[charId] ? charId : 'naruto';
        room.players.set(socket.id, createPlayerState(socket.id, name, 0, safeChar));
        rooms.set(code, room);
        currentRoomCode = code;
        socket.join(code);
        broadcastLobby(room);
    });

    socket.on('joinRoom', ({ code, name, charId }) => {
        removePlayerFromRoom();
        const cleanCode = (code || '').trim();
        const room = rooms.get(cleanCode);
        if (!room) {
            socket.emit('roomError', '找不到此房間號碼，請確認房號是否正確！');
            return;
        }
        if (room.state !== 'LOBBY') {
            socket.emit('roomError', '該房間遊戲已經開始，請等下一局！');
            return;
        }
        if (room.players.size >= 3) {
            socket.emit('roomError', '房間已滿（最多 3 人合作）！');
            return;
        }
        const slot = room.players.size;
        const safeChar = CHAR_CONFIG[charId] ? charId : 'kakashi';
        room.players.set(socket.id, createPlayerState(socket.id, name, slot, safeChar));
        currentRoomCode = cleanCode;
        socket.join(cleanCode);
        broadcastLobby(room);
    });

    socket.on('leaveRoom', () => {
        removePlayerFromRoom();
    });

    socket.on('selectChar', (charId) => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room || room.state !== 'LOBBY') return;
        const p = room.players.get(socket.id);
        if (p && CHAR_CONFIG[charId]) {
            p.charId = charId;
            broadcastLobby(room);
        }
    });

    socket.on('startGame', () => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room || room.hostId !== socket.id) return;
        startRoomGame(room);
    });

    socket.on('togglePause', () => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        const p = room.players.get(socket.id);
        if (!p) return;

        if (room.state === 'PLAYING') {
            room.state = 'PAUSED';
            room.pausedBy = p.name;
            io.to(room.code).emit('gamePaused', { pausedBy: p.name });
        } else if (room.state === 'PAUSED') {
            room.state = 'PLAYING';
            room.pausedBy = null;
            io.to(room.code).emit('gameResumed');
        }
    });

    socket.on('input', ({ dx, dy }) => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        const p = room.players.get(socket.id);
        if (p) {
            p.dx = Math.max(-1, Math.min(1, Number(dx) || 0));
            p.dy = Math.max(-1, Math.min(1, Number(dy) || 0));
        }
    });

    socket.on('chooseUpgrade', (upgradeId) => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room || room.state !== 'LEVELUP') return;
        const p = room.players.get(socket.id);
        if (p && p.pendingUpgrade) {
            applyPlayerUpgrade(p, upgradeId);
            p.pendingUpgrade = false;
            emitUpgradeStatus(room);
        }
    });

    socket.on('restartGame', () => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room || room.hostId !== socket.id) return;
        startRoomGame(room);
    });

    socket.on('disconnect', () => {
        removePlayerFromRoom();
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
