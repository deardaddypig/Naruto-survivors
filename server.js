const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('Naruto Survivors 3-Player Co-op Server is Running!');
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

const CHAR_CONFIG = {
    naruto: {
        name: '漩渦鳴人',
        maxHp: 110,
        speed: 225,
        weapon: 'shuriken',
        cooldown: 0.95,
        damage: 20,
        count: 1
    },
    kakashi: {
        name: '旗木卡卡西',
        maxHp: 95,
        speed: 245,
        weapon: 'kunai',
        cooldown: 1.05,
        damage: 28,
        count: 1
    },
    jiraiya: {
        name: '自來也',
        maxHp: 135,
        speed: 200,
        weapon: 'needle',
        cooldown: 1.35,
        damage: 16,
        count: 3
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
    ]
};

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
        facing: 'right',
        hp: cfg.maxHp,
        maxHp: cfg.maxHp,
        speed: cfg.speed,
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
    room.gameTime = 0;
    room.teamLevel = 1;
    room.teamXp = 0;
    room.teamXpNext = 30;
    room.totalKills = 0;
    room.spawnTimer = 0.5;
    room.nextEntityId = 1;
    room.enemies = [];
    room.projectiles = [];
    room.gems = [];

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
        const pool = UPGRADE_POOL[p.charId].filter(u => {
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
            p.weapon.damage += (p.charId === 'kakashi' ? 15 : p.charId === 'naruto' ? 12 : 10);
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
        case 'clone':
            if (p.skills.clones < 2) p.skills.clones++;
            break;
        case 'hp':
            p.maxHp += 30;
            p.hp = Math.min(p.maxHp, p.hp + 65);
            break;
        case 'speed':
            p.speed *= 1.15;
            break;
        case 'magnet':
            p.pickupRange *= 1.5;
            break;
    }
}

function damageEnemy(room, enemy, amount, attacker, color = '#fde047') {
    if (enemy.hp <= 0) return;
    enemy.hp -= amount;
    enemy.hitTimer = 0.11;

    io.to(room.code).emit('fx', {
        type: 'dmg',
        x: enemy.x,
        y: enemy.y - enemy.radius - 8,
        val: Math.floor(amount),
        color
    });

    if (attacker) {
        const angle = Math.atan2(enemy.y - attacker.y, enemy.x - attacker.x);
        const kb = enemy.type === 'elite' ? 0.3 : 1.0;
        enemy.vx = Math.cos(angle) * 70 * kb;
        enemy.vy = Math.sin(angle) * 70 * kb;
    }

    if (enemy.hp <= 0) {
        room.totalKills++;
        if (attacker) attacker.kills++;
        room.gems.push({
            id: room.nextEntityId++,
            x: enemy.x,
            y: enemy.y,
            value: enemy.xpValue
        });
        io.to(room.code).emit('fx', {
            type: 'poof',
            x: enemy.x,
            y: enemy.y
        });
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
        io.to(room.code).emit('gameOver', {
            time: room.gameTime,
            level: room.teamLevel,
            totalKills: room.totalKills,
            players: players.map(p => ({
                name: p.name,
                charId: p.charId,
                kills: p.kills
            }))
        });
        return;
    }

    // 1. 更新玩家移動、技能與倒地救援
    for (const p of players) {
        if (p.hitTimer > 0) p.hitTimer = Math.max(0, p.hitTimer - dt);

        if (p.downed) {
            // 檢查是否有存活隊友在救援光圈（半徑 65）內
            let rescuerNearby = false;
            for (const ally of alivePlayers) {
                if (Math.hypot(ally.x - p.x, ally.y - p.y) <= 68) {
                    rescuerNearby = true;
                    break;
                }
            }
            if (rescuerNearby) {
                p.reviveProgress += dt / 3.0; // 3 秒救起
                if (p.reviveProgress >= 1) {
                    p.downed = false;
                    p.reviveProgress = 0;
                    p.hp = Math.round(p.maxHp * 0.5);
                    p.hitTimer = 1.5;
                    io.to(room.code).emit('fx', { type: 'revive', x: p.x, y: p.y, name: p.name });
                }
            } else {
                p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.35);
            }
            continue;
        }

        // 存活玩家移動
        if (p.dx !== 0 || p.dy !== 0) {
            const len = Math.hypot(p.dx, p.dy);
            p.x += (p.dx / len) * p.speed * dt;
            p.y += (p.dy / len) * p.speed * dt;
            if (p.dx < 0) p.facing = 'left';
            if (p.dx > 0) p.facing = 'right';
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
            if (nearest && minDist < 750) {
                const baseAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
                p.facing = Math.cos(baseAngle) >= 0 ? 'right' : 'left';
                const cnt = p.weapon.count;
                const spreadStep = p.charId === 'jiraiya' ? 0.14 : 0.17;
                for (let i = 0; i < cnt; i++) {
                    const angle = baseAngle + (i - (cnt - 1) / 2) * spreadStep;
                    room.projectiles.push({
                        id: room.nextEntityId++,
                        ownerId: p.id,
                        kind: p.weapon.type,
                        x: p.x,
                        y: p.y,
                        vx: Math.cos(angle) * 690,
                        vy: Math.sin(angle) * 690,
                        angle,
                        damage: p.weapon.damage,
                        radius: p.weapon.type === 'shuriken' ? 10 : 8,
                        life: 1.6
                    });
                }
                io.to(room.code).emit('sfx', 'kunai');
                p.weapon.timer = p.weapon.cooldown;
            }
        }

        // 鳴人影分身射擊
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
                    if (nearest && minD < 700) {
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
                            life: 1.5
                        });
                    }
                    p.skills.cloneTimers[c] = p.weapon.cooldown * 1.15;
                }
            }
        }

        // 螺旋丸領域 (鳴人 / 自來也)
        if (p.skills.rasengan.level > 0) {
            p.skills.rasengan.timer -= dt;
            if (p.skills.rasengan.timer <= 0) {
                p.skills.rasengan.timer = p.skills.rasengan.cooldown;
                const r = p.skills.rasengan.radius;
                io.to(room.code).emit('fx', { type: 'rasengan', x: p.x, y: p.y, r });
                io.to(room.code).emit('sfx', 'rasengan');
                for (const e of room.enemies) {
                    if (Math.hypot(e.x - p.x, e.y - p.y) < r + e.radius) {
                        damageEnemy(room, e, p.skills.rasengan.damage, p, '#38bdf8');
                        e.slowTimer = 1.1;
                    }
                }
            }
        }

        // 卡卡西雷切環繞雷球碰撞
        if (p.skills.raikiri.level > 0) {
            const rk = p.skills.raikiri;
            const time = room.gameTime * rk.speed;
            for (let i = 0; i < rk.count; i++) {
                const ang = time + ((Math.PI * 2) / rk.count) * i;
                const sx = p.x + Math.cos(ang) * rk.radius;
                const sy = p.y + Math.sin(ang) * rk.radius;
                for (const e of room.enemies) {
                    if (e.hitTimer > 0) continue;
                    if (Math.hypot(e.x - sx, e.y - sy) < 15 + e.radius) {
                        damageEnemy(room, e, rk.damage, p, '#7dd3fc');
                        const kb = Math.atan2(e.y - sy, e.x - sx);
                        e.vx = Math.cos(kb) * 320;
                        e.vy = Math.sin(kb) * 320;
                    }
                }
            }
        }

        // 卡卡西雷遁・連鎖紫電
        if (p.skills.lightning.level > 0 && room.enemies.length > 0) {
            p.skills.lightning.timer -= dt;
            if (p.skills.lightning.timer <= 0) {
                p.skills.lightning.timer = p.skills.lightning.cooldown;
                const candidates = room.enemies
                    .filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 420)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, p.skills.lightning.bolts);

                if (candidates.length > 0) {
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const target of candidates) {
                        io.to(room.code).emit('fx', {
                            type: 'lightning',
                            x1: p.x,
                            y1: p.y - 12,
                            x2: target.x,
                            y2: target.y
                        });
                        damageEnemy(room, target, p.skills.lightning.damage, p, '#c084fc');
                    }
                }
            }
        }

        // 自來也火遁・大炎彈
        if (p.skills.fireball.level > 0 && room.enemies.length > 0) {
            p.skills.fireball.timer -= dt;
            if (p.skills.fireball.timer <= 0) {
                p.skills.fireball.timer = p.skills.fireball.cooldown;
                let nearest = null, minD = Infinity;
                for (const e of room.enemies) {
                    const d = Math.hypot(e.x - p.x, e.y - p.y);
                    if (d < minD) { minD = d; nearest = e; }
                }
                if (nearest && minD < 680) {
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
                        life: 2.0
                    });
                    io.to(room.code).emit('sfx', 'kunai');
                }
            }
        }
    }

    // 2. 敵人波次生成（隨玩家人數與時間動態調整難度）
    room.spawnTimer -= dt;
    if (room.spawnTimer <= 0 && room.enemies.length < 150) {
        const playerScale = 1 + (players.length - 1) * 0.55;
        const spawnRate = Math.max(0.22, (0.95 - room.gameTime / 280) / playerScale);
        const spawnCount = Math.max(1, Math.floor((1 + room.gameTime / 45) * (1 + (players.length - 1) * 0.35)));
        const hpMult = (1 + room.gameTime / 110) * (1 + (players.length - 1) * 0.25);

        for (let i = 0; i < spawnCount; i++) {
            const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            const angle = Math.random() * Math.PI * 2;
            const dist = 620 + Math.random() * 120;
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
                x: anchor.x + Math.cos(angle) * dist,
                y: anchor.y + Math.sin(angle) * dist,
                vx: 0,
                vy: 0,
                facing: 'left',
                hp: stats.hp,
                maxHp: stats.hp,
                speed: stats.speed,
                damage: stats.damage,
                radius: stats.radius,
                xpValue: stats.xp,
                hitTimer: 0,
                slowTimer: 0
            });
        }
        room.spawnTimer = spawnRate;
    }

    // 3. 更新投射物與碰撞
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
            if (Math.hypot(proj.x - e.x, proj.y - e.y) < proj.radius + e.radius) {
                if (proj.kind === 'fireball') {
                    // 大炎彈範圍爆炸
                    io.to(room.code).emit('fx', {
                        type: 'explosion',
                        x: proj.x,
                        y: proj.y,
                        r: proj.blastRadius
                    });
                    io.to(room.code).emit('sfx', 'rasengan');
                    for (const target of room.enemies) {
                        if (Math.hypot(target.x - proj.x, target.y - proj.y) <= proj.blastRadius + target.radius) {
                            damageEnemy(room, target, proj.damage, owner, '#fb923c');
                        }
                    }
                } else {
                    damageEnemy(room, e, proj.damage, owner, '#fde047');
                }
                room.projectiles.splice(i, 1);
                break;
            }
        }
    }

    // 4. 更新敵人 AI 追蹤最近存活忍者
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

        const spd = e.slowTimer > 0 ? e.speed * 0.48 : e.speed;
        e.vx *= 0.88;
        e.vy *= 0.88;

        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        e.facing = Math.cos(angle) >= 0 ? 'right' : 'left';
        e.x += (Math.cos(angle) * spd + e.vx) * dt;
        e.y += (Math.sin(angle) * spd + e.vy) * dt;

        // 碰撞傷害檢查
        for (const p of alivePlayers) {
            if (p.hitTimer > 0) continue;
            if (Math.hypot(p.x - e.x, p.y - e.y) < p.radius + e.radius - 4) {
                p.hp = Math.max(0, p.hp - e.damage);
                p.hitTimer = 0.55;
                io.to(p.id).emit('playerHurt');
                if (p.hp <= 0) {
                    if (players.length === 1) {
                        p.downed = true;
                    } else {
                        p.downed = true;
                        p.reviveProgress = 0;
                        io.to(room.code).emit('fx', { type: 'downed', x: p.x, y: p.y, name: p.name });
                    }
                }
            }
        }
    }

    // 5. 更新查克拉經驗寶石磁力吸引
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

// 30Hz 伺服器物理運算
setInterval(() => {
    const dt = 1 / 30;
    for (const room of rooms.values()) {
        stepRoom(room, dt);
    }
}, 1000 / 30);

// 20Hz 狀態廣播至各房間玩家
setInterval(() => {
    for (const room of rooms.values()) {
        if (room.state === 'PLAYING' || room.state === 'LEVELUP') {
            io.to(room.code).emit('state', {
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
                    facing: p.facing,
                    moving: p.dx !== 0 || p.dy !== 0,
                    hp: p.hp,
                    maxHp: p.maxHp,
                    hit: p.hitTimer > 0.35,
                    downed: p.downed,
                    revive: p.reviveProgress,
                    wCount: p.weapon.count,
                    rasenLv: p.skills.rasengan.level,
                    rasenR: p.skills.rasengan.radius,
                    raikiriLv: p.skills.raikiri.level,
                    raikiriCnt: p.skills.raikiri.count,
                    raikiriR: p.skills.raikiri.radius,
                    raikiriSpd: p.skills.raikiri.speed,
                    lightLv: p.skills.lightning.level,
                    fireLv: p.skills.fireball.level,
                    clones: p.skills.clones
                })),
                enemies: room.enemies.map(e => ({
                    id: e.id,
                    type: e.type,
                    x: Math.round(e.x),
                    y: Math.round(e.y),
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
                    angle: pr.angle
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
}, 50);

io.on('connection', (socket) => {
    let currentRoomCode = null;

    socket.on('createRoom', ({ name, charId }) => {
        const code = generateRoomCode();
        const room = {
            code,
            hostId: socket.id,
            state: 'LOBBY',
            players: new Map(),
            enemies: [],
            projectiles: [],
            gems: [],
            gameTime: 0,
            teamLevel: 1,
            teamXp: 0,
            teamXpNext: 30,
            totalKills: 0,
            spawnTimer: 0,
            nextEntityId: 1
        };
        room.players.set(socket.id, createPlayerState(socket.id, name, 0, charId || 'naruto'));
        rooms.set(code, room);
        currentRoomCode = code;
        socket.join(code);
        broadcastLobby(room);
    });

    socket.on('joinRoom', ({ code, name, charId }) => {
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
        room.players.set(socket.id, createPlayerState(socket.id, name, slot, charId || 'kakashi'));
        currentRoomCode = cleanCode;
        socket.join(cleanCode);
        broadcastLobby(room);
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
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        room.players.delete(socket.id);

        if (room.players.size === 0) {
            rooms.delete(currentRoomCode);
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
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});