const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 靜態文件服務
app.use(express.static(path.join(__dirname, 'public')));

// 房間管理
const rooms = new Map();

// 遊戲狀態
// 卡牌类型定义
const CARD_TYPES = ['convert', 'obstacle', 'storm', 'undo', 'trap', 'hint', 'peek'];
const CARD_PROBABILITIES = { convert: 20, obstacle: 20, storm: 20, undo: 10, trap: 10, hint: 10, peek: 10 };
function getRandomCard() {
    const total = Object.values(CARD_PROBABILITIES).reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    for (const type of CARD_TYPES) {
        rand -= CARD_PROBABILITIES[type];
        if (rand < 0) return { type };
    }
    return { type: CARD_TYPES[0] };
}
// 新增 socket 事件
// 1. 先定义 class GameRoom
class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = []; // 存储玩家对象，例如 { id: socket.id, name: playerName }
        this.board = Array(15).fill().map(() => Array(15).fill(0)); // 棋盘状态
        this.currentPlayer = 0; // 当前玩家索引
        this.winner = null;
        this.cards = [[], []]; // 存储玩家卡牌
        this.obstacles = []; // 障碍物
        this.traps = []; // 陷阱
        this.lastMoves = []; // 最后几步棋
        // 其他游戏状态属性...
    }

    addPlayer(socket, playerName) {
        if (this.players.length < 2) {
            this.players.push({ id: socket.id, name: playerName });
            return true;
        }
        return false;
    }

    removePlayer(socketId) {
        this.players = this.players.filter(player => player.id !== socketId);
    }

    startGame() {
        if (this.players.length === 2) {
            this.currentPlayer = Math.floor(Math.random() * 2);
            this.winner = null;
            this.board = Array(15).fill().map(() => Array(15).fill(0));
            this.cards = [[], []];
            this.obstacles = [];
            this.traps = [];
            this.lastMoves = [];
            console.log(`Game started in room ${this.roomId}, current player: ${this.players[this.currentPlayer]?.name}`);
        }
    }

    makeMove(row, col, playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1 || playerIndex !== this.currentPlayer || this.board[row][col] !== 0 || this.winner !== null) {
            return false;
        }

        // 检查是否为障碍物
        if (this.obstacles.some(o => o.row === row && o.col === col)) {
            console.log(`Invalid move: trying to place on an obstacle at (${row}, ${col})`);
            return false; // 不能在障碍物上下棋
        }

        this.board[row][col] = playerIndex + 1;

        const trapIndex = this.traps.findIndex(t => t.row === row && t.col === col);
        if (trapIndex !== -1) {
            const trap = this.traps[trapIndex];
            if (trap.playerId !== playerIndex) { // 对方的陷阱
                this.traps.splice(trapIndex, 1)[0]; // 移除陷阱
                this.board[row][col] = 0; // 移除觸發陷阱的棋子
                this.currentPlayer = 1 - this.currentPlayer; // 切换回合 (觸發者跳过)
                io.to(this.roomId).emit('trapTriggered', {
                    row,
                    col,
                    byPlayerId: trap.playerId, // 放置陷阱的玩家 ID
                    victimPlayerIndex: playerIndex, // 踩到陷阱的玩家索引
                    board: this.board,
                    currentPlayer: this.currentPlayer,
                    removedTraps: [{ row, col }] // 告知客戶端哪些陷阱被移除了
                });
                this.lastMoves.push({ row, col, player: playerIndex + 1, isTrapTrigger: true }); // 记录这一步，标记为陷阱触发
                return true; // 移动有效，但触发了陷阱
            }
        }

        if (this.checkWin(row, col, playerIndex + 1)) {
            this.winner = playerIndex;
            return 'win';
        }

        this.currentPlayer = 1 - this.currentPlayer;
        return true;
    }

    checkWin(row, col, player) {
        // 检查水平方向
        let count = 0;
        for (let i = Math.max(0, col - 4); i <= Math.min(14, col + 4); i++) {
            if (this.board[row][i] === player) {
                count++;
                if (count >= 5) return true;
            } else {
                count = 0;
            }
        }

        // 检查垂直方向
        count = 0;
        for (let i = Math.max(0, row - 4); i <= Math.min(14, row + 4); i++) {
            if (this.board[i][col] === player) {
                count++;
                if (count >= 5) return true;
            } else {
                count = 0;
            }
        }

        // 检查主对角线 \
        count = 0;
        for (let i = -4; i <= 4; i++) {
            const r = row + i;
            const c = col + i;
            if (r >= 0 && r < 15 && c >= 0 && c < 15) {
                if (this.board[r][c] === player) {
                    count++;
                    if (count >= 5) return true;
                } else {
                    count = 0;
                }
            }
        }

        // 检查副对角线 /
        count = 0;
        for (let i = -4; i <= 4; i++) {
            const r = row + i;
            const c = col - i;
            if (r >= 0 && r < 15 && c >= 0 && c < 15) {
                if (this.board[r][c] === player) {
                    count++;
                    if (count >= 5) return true;
                } else {
                    count = 0;
                }
            }
        }
        return false;
    }
}

io.on('connection', (socket) => {
    console.log('玩家連接:', socket.id);

    socket.on('createRoom', (data) => {
        const playerName = data.playerName || '匿名玩家';
        const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
        const room = new GameRoom(roomId);
        rooms.set(roomId, room);
        
        socket.join(roomId);
        room.addPlayer(socket, playerName);
        
        socket.emit('roomCreated', {
            roomId: roomId,
            playerIndex: 0 // 创建者总是0号玩家
        });
        console.log(`玩家 ${playerName} 創建房間 ${roomId}`);
    });

    socket.on('joinRoom', (data) => {
        const roomId = data.roomId?.toUpperCase();
        const playerName = data.playerName || '匿名玩家';
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: '房間不存在' });
            return;
        }
        
        if (room.players.some(p => p.id === socket.id)) {
            socket.emit('error', { message: '您已在房間中' });
            // 重新发送房间信息以同步状态
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            socket.emit('roomJoined', { roomId: roomId, playerIndex: playerIndex });
            io.to(roomId).emit('playerJoined', { players: room.players.map(p => ({ name: p.name, id: p.id })) });
            if (room.gameStarted) {
                 socket.emit('gameStart', { // Or a more specific "rejoinGame" event
                    currentPlayer: room.currentPlayer,
                    players: room.players.map(p => ({ name: p.name, id: p.id })),
                    board: room.board,
                    myCards: room.cards[playerIndex],
                    opponentCardCount: room.cards[1-playerIndex]?.length || 0,
                    obstacles: room.obstacles,
                    traps: room.traps.map(t => ({ row: t.row, col: t.col, playerId: t.playerId })) // Ensure full trap info for client
                });
            }
            return;
        }

        if (room.addPlayer(socket, playerName)) {
            socket.join(roomId);
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            socket.emit('roomJoined', {
                roomId: roomId,
                playerIndex: playerIndex
            });
            
            io.to(roomId).emit('playerJoined', {
                players: room.players.map(p => ({ name: p.name, id: p.id }))
            });
            
            if (room.players.length === 2) {
                room.startGame(); // This will initialize cards array to [[],[]]
                io.to(roomId).emit('gameStart', {
                    currentPlayer: room.currentPlayer,
                    players: room.players.map(p => ({ name: p.name, id: p.id })),
                    board: room.board, // Send initial board
                    // Send initial empty cards or let client request them
                    myCards: [[],[]], // Send empty card arrays initially
                    opponentCardCount: 0,
                    obstacles: room.obstacles,
                    traps: room.traps
                });
            }
            console.log(`玩家 ${playerName} 加入房間 ${roomId}`);
        } else {
            socket.emit('error', { message: '房間已滿' });
        }
    });

    socket.on('requestCard', (data) => {
        const room = rooms.get(data.roomId);
        if (!room || !room.players.find(p => p.id === socket.id)) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1 || room.cards[playerIndex].length >= 5) { // Max 5 cards
            return;
        }
        const card = getRandomCard();
        room.cards[playerIndex].push(card);

        // 只將卡牌信息發送給請求的玩家
        socket.emit('cardReceived', {
            card: card, // 只發送新獲得的卡牌
            playerIndex: playerIndex // 雖然客戶端知道自己的index，但以防萬一
        });
        // 通知對手卡牌數量變化
        const opponentSocketId = room.players[1 - playerIndex]?.id;
        if (opponentSocketId) {
            io.to(opponentSocketId).emit('opponentCardCountUpdate', { count: room.cards[playerIndex].length });
        }
    });

    socket.on('useCard', (data) => {
        const room = rooms.get(data.roomId);
        if (!room) {
            socket.emit('error', { message: '房間不存在，無法使用卡牌。' });
            return;
        }
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) {
            socket.emit('error', { message: '玩家不在房間中，無法使用卡牌。' });
            return;
        }
        if (playerIndex !== room.currentPlayer) {
             socket.emit('error', { message: '不是你的回合，無法使用卡牌。' });
            return;
        }

        const cardIndex = data.cardIndex;
        if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= room.cards[playerIndex].length) {
            socket.emit('error', { message: '無效的卡牌索引。' });
            return;
        }

        // 先取出卡牌，如果後續操作失敗，再將其插回
        const card = room.cards[playerIndex].splice(cardIndex, 1)[0];
        if (!card) {
            // 理論上不應該發生，因為上面已經檢查了 cardIndex
            socket.emit('error', { message: '找不到指定的卡牌。' });
            return;
        }

        let effectData = {
            roomId: data.roomId, // Keep roomId for client-side context if needed
            playerId: playerIndex, // The player who used the card
            playerName: room.players[playerIndex].name,
            card: card, // The actual card object used
            cardIndex: cardIndex, // The original index of the card in player's hand
            effect: card.type // Add effect type for easier client handling
        };
        let effectApplied = false;

        switch (card.type) {
            case 'convert': {
                if (!data.target || typeof data.target.row !== 'number' || typeof data.target.col !== 'number') {
                    socket.emit('error', { message: '轉換卡：目標位置無效。' });
                    break; // Will go to re-insert logic
                }
                const { row, col } = data.target;
                if (room.board[row][col] !== 0 && room.board[row][col] !== (playerIndex + 1)) {
                    // 檢查轉換後是否會直接形成五子連線
                    const tempBoardVal = room.board[row][col];
                    room.board[row][col] = playerIndex + 1;
                    if (room.checkWin(row, col, playerIndex + 1)) {
                        room.board[row][col] = tempBoardVal; // 還原
                        socket.emit('error', { message: '轉換卡：此操作會立即導致您獲勝，轉換無效。' });
                        break;
                    }
                    // room.board[row][col] is already set from checkWin if not win
                    effectData.target = { row, col };
                    effectData.convertedFrom = tempBoardVal; // 告知客戶端被轉換的棋子原來的歸屬
                    effectApplied = true;
                } else {
                    socket.emit('error', { message: '轉換卡：目標不是對方棋子或為空。' });
                }
                break;
            }
            case 'obstacle': {
                if (!data.target || typeof data.target.row !== 'number' || typeof data.target.col !== 'number') {
                    socket.emit('error', { message: '障礙卡：目標位置無效。' });
                    break;
                }
                const { row, col } = data.target;
                if (room.board[row][col] === 0 && !room.obstacles.some(o => o.row === row && o.col === col)) {
                    room.obstacles.push({ row, col });
                    effectData.target = { row, col };
                    effectApplied = true;
                } else {
                    socket.emit('error', { message: '障礙卡：目標位置已有棋子或障礙物。' });
                }
                break;
            }
            case 'storm': {
                let allPieces = [];
                for (let r = 0; r < 15; r++) {
                    for (let c = 0; c < 15; c++) {
                        if (room.board[r][c] !== 0) allPieces.push({ row: r, col: c, player: room.board[r][c] });
                    }
                }
                if (allPieces.length < 3) {
                    socket.emit('error', { message: '棋盤風暴：場上棋子不足3顆。' });
                    break;
                }
                let moveCount = Math.min(5, Math.max(3, Math.floor(allPieces.length / 3)));
                let movedPiecesServer = []; // Renamed to avoid conflict with client's "target"
                let tempBoard = room.board.map(arr => arr.slice()); // Create a temporary board for storm simulation

                for (let i = 0; i < moveCount && allPieces.length > 0; i++) {
                    let pieceIdx = Math.floor(Math.random() * allPieces.length);
                    let piece = allPieces.splice(pieceIdx, 1)[0];
                    
                    let emptySpots = [];
                    for (let r = 0; r < 15; r++) {
                        for (let c = 0; c < 15; c++) {
                            if (tempBoard[r][c] === 0 && !room.obstacles.some(o => o.row === r && o.col === c)) {
                                emptySpots.push({ row: r, col: c });
                            }
                        }
                    }
                    if (emptySpots.length === 0) break; // No empty spots left

                    let newPos = emptySpots[Math.floor(Math.random() * emptySpots.length)];
                    
                    tempBoard[piece.row][piece.col] = 0; // Remove from old position on temp board
                    tempBoard[newPos.row][newPos.col] = piece.player; // Place on new position on temp board
                    movedPiecesServer.push({ from: { row: piece.row, col: piece.col }, to: newPos, player: piece.player });
                }
                // Apply changes to the actual board
                room.board = tempBoard;
                effectData.moved = movedPiecesServer; // Server calculated moves
                effectApplied = true;
                break;
            }
            case 'undo': {
                if (room.lastMoves.length > 0) {
                    // 确保最后一步不是对方的陷阱触发，或者不是自己因陷阱触发而产生的"空"移动
                    const lastMoveToUndo = room.lastMoves[room.lastMoves.length - 1];
                    if (lastMoveToUndo.isTrapTrigger && lastMoveToUndo.player !== (playerIndex +1) ) {
                         socket.emit('error', { message: '悔棋：無法悔掉對方觸發的陷阱。'});
                         break;
                    }

                    let move = room.lastMoves.pop();
                    if (move.isTrapTrigger && move.player === (playerIndex + 1)) { // 自己踩到对方陷阱后被移除的棋子
                        // 这步棋实际上是空的，棋子已经被移除了。悔棋应该恢复棋子。
                        // 但简单悔棋是移除棋盘上的棋子，这里逻辑可能需要调整，或者不允许悔这种棋
                        // 为了简单，我们假设悔棋总是清除棋盘上的一个点
                        // room.board[move.row][move.col] = 0; // 已经是0了
                    } else {
                         room.board[move.row][move.col] = 0; // 正常移除棋子
                    }

                    room.currentPlayer = playerIndex; // 使用者重新获得回合
                    effectData.undoneMove = move; // Use server's last move
                    effectApplied = true;
                } else {
                    socket.emit('error', { message: '悔棋：沒有可悔的棋步。' });
                }
                break;
            }
            case 'trap': {
                if (!data.target || typeof data.target.row !== 'number' || typeof data.target.col !== 'number') {
                    socket.emit('error', { message: '陷阱卡：目標位置無效。' });
                    break;
                }
                const { row, col } = data.target;
                if (room.board[row][col] === 0 && !room.traps.some(t => t.row === row && t.col === col) && !room.obstacles.some(o => o.row ===row && o.col === col)) {
                    room.traps.push({ row, col, playerId: playerIndex });
                    effectData.target = { row, col };
                    effectApplied = true;
                } else {
                    socket.emit('error', { message: '陷阱卡：目標位置已有棋子、陷阱或障礙物。' });
                }
                break;
            }
            case 'hint': {
                // Hint effect: Server could calculate a hint.
                // For simplicity, we'll assume client-side handles hint display based on this event.
                // Server doesn't need to send a specific target for hint unless it calculates one.
                // Let's say hint card just "activates" and client shows generic help or highlights something.
                // Or, server calculates a good move and sends it.
                // For now, just acknowledge use.
                // Example: Find a good move for the player
                // This is a placeholder, a real hint would be more complex
                let hintTarget = null;
                // Basic: find first empty spot near center
                const centerOffsets = [0, -1, 1, -2, 2];
                foundHint:
                for (let rOffset of centerOffsets) {
                    for (let cOffset of centerOffsets) {
                        const r = 7 + rOffset;
                        const c = 7 + cOffset;
                        if (r >=0 && r < 15 && c >=0 && c < 15 && room.board[r][c] === 0 && !room.obstacles.some(o=>o.row===r && o.col===c)) {
                            hintTarget = {row: r, col: c};
                            break foundHint;
                        }
                    }
                }
                if (hintTarget) {
                    effectData.hintTarget = hintTarget;
                }
                effectApplied = true;
                break;
            }
            case 'peek': {
                let opponentIndex = 1 - playerIndex;
                if (room.players[opponentIndex]) { // Check if opponent exists
                    let opponentCards = room.cards[opponentIndex];
                    if (opponentCards.length > 0) {
                        let peekedCard = opponentCards[Math.floor(Math.random() * opponentCards.length)];
                        effectData.peekType = peekedCard.type; // Send only type to the peeking player
                    } else {
                        effectData.peekType = null; // Opponent has no cards
                    }
                } else {
                     effectData.peekType = null; // No opponent
                }
                effectApplied = true;
                break;
            }
            default:
                socket.emit('error', { message: '未知的卡牌類型。' });
                break;
        }

        if (effectApplied) {
            // 效果成功應用，通知房間內所有玩家
            // 某些效果可能只需要通知使用者，例如 peek, hint
            if (card.type === 'peek' || card.type === 'hint') {
                socket.emit('cardUsed', effectData); // 只通知使用者
                // 通知對手（如果卡牌效果對他可見，例如"你的卡牌被窺探了"）
                if (card.type === 'peek' && room.players[1-playerIndex]) {
                    io.to(room.players[1-playerIndex].id).emit('cardUsedOnYou', {
                        type: 'peek',
                        byPlayerName: room.players[playerIndex].name
                    });
                }
            } else {
                 // 對於影響棋盤或公開資訊的卡牌，通知所有人
                io.to(data.roomId).emit('cardUsed', {
                    ...effectData,
                    board: room.board, // Send updated board
                    obstacles: room.obstacles, // Send updated obstacles
                    traps: room.traps, // Send updated traps
                    currentPlayer: room.currentPlayer // card might change current player (undo)
                });
            }

            // 卡牌使用後，輪到對方下棋 (除非是悔棋卡，悔棋卡已在內部設定currentPlayer)
            if (card.type !== 'undo') {
                 room.currentPlayer = 1 - room.currentPlayer;
                 io.to(data.roomId).emit('turnChange', { currentPlayer: room.currentPlayer });
            }


        } else {
            // 效果未應用，將卡牌重新插入原位
            room.cards[playerIndex].splice(cardIndex, 0, card);
            // socket.emit('error', ...) 已經在各自的 case 中發送了
        }
    });

    socket.on('makeMove', (data) => {
        const room = rooms.get(data.roomId);
        if (!room) {
            socket.emit('error', { message: '房間不存在' });
            return;
        }
        const playerMakingMove = room.players.find(p => p.id === socket.id);
        if (!playerMakingMove) {
            socket.emit('error', { message: '玩家不在房間中' });
            return;
        }

        const result = room.makeMove(data.row, data.col, socket.id);

        if (result === true) { // Move successful or trap triggered (handled by makeMove emitting trapTriggered)
            if (!room.board[data.row]?.[data.col] && room.traps.some(t => t.row === data.row && t.col === data.col)) {
                // This means a trap was triggered and the piece was removed by makeMove.
                // The 'trapTriggered' event already handled the board update.
                // We still record the attempted move.
                room.lastMoves.push({ row: data.row, col: data.col, player: room.players.findIndex(p => p.id === socket.id) + 1, wasTrapped: true });

            } else {
                 room.lastMoves.push({ row: data.row, col: data.col, player: room.players.findIndex(p => p.id === socket.id) + 1 });
                io.to(data.roomId).emit('moveMade', {
                    row: data.row,
                    col: data.col,
                    player: room.players.findIndex(p => p.id === socket.id), // player index (0 or 1)
                    currentPlayer: room.currentPlayer,
                    board: room.board
                });
            }
        } else if (result === 'win') {
            room.lastMoves.push({ row: data.row, col: data.col, player: room.players.findIndex(p => p.id === socket.id) + 1 });
            io.to(data.roomId).emit('gameEnd', {
                winner: room.winner,
                winnerName: room.players[room.winner].name,
                board: room.board
            });
        } else { // result === false (invalid move)
            socket.emit('error', { message: '無效的移動' });
        }
    });

    socket.on('restartGame', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.players.length === 2) {
            room.startGame(); // Resets board, winner, cards, obstacles, traps, lastMoves
            io.to(data.roomId).emit('gameRestart', {
                currentPlayer: room.currentPlayer,
                board: room.board,
                myCards: [[],[]], // Send fresh empty card arrays
                opponentCardCount: 0,
                obstacles: room.obstacles,
                traps: room.traps
            });
        }
    });
    
    socket.on('trapTriggered', (data) => { // Client informs server a trap it placed was triggered
        const room = rooms.get(data.roomId);
        if (!room) return;
        // This event seems redundant if server's makeMove handles trap triggering and board updates.
        // Client should react to server's authoritative trapTriggered or moveMade event.
        // For now, let's assume this is for logging or a specific client-side action confirmation.
        console.log(`Trap triggered at (${data.row}, ${data.col}) in room ${data.roomId} as reported by client.`);
    });


    // 刪除這段
    socket.on('chatMessage', data => {
    io.to(data.roomId).emit('chatMessage', {
        name: data.name,
        message: data.message
    });
    });

    socket.on('disconnect', () => {
        console.log('玩家斷線:', socket.id);
        for (let [roomId, room] of rooms) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const playerName = room.players[playerIndex].name;
                room.removePlayer(socket.id);
                
                socket.to(roomId).emit('playerLeft', {
                    playerId: socket.id, // Send ID of player who left
                    playerName: playerName,
                    players: room.players.map(p => ({ name: p.name, id: p.id }))
                });
                
                if (room.players.length < 2) {
                    // Reset game or notify remaining player
                    room.winner = null; // No winner if game ends due to disconnect
                    // Optionally, delete room if 0 players, or wait for new player if 1
                    if (room.players.length === 0) {
                        rooms.delete(roomId);
                        console.log(`房間 ${roomId} 已刪除，因為所有玩家都已離開。`);
                    } else {
                        // Notify the remaining player that the opponent left and game might need reset or wait
                        io.to(room.players[0].id).emit('opponentLeftGame', { message: '對手已離開，遊戲暫停。'});
                    }
                }
                break;
            }
        }
    });

    socket.on('setCardProbabilities', (data) => {
        // This should be protected or removed in a production environment
        // For development, it's fine.
        for (const type in data) {
            if (CARD_PROBABILITIES.hasOwnProperty(type)) {
                CARD_PROBABILITIES[type] = Math.max(0, Math.min(100, Number(data[type])));
            }
        }
        console.log("Card probabilities updated:", CARD_PROBABILITIES);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服務器運行在 http://localhost:${PORT}`);
});