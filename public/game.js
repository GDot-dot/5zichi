class GomokuGame {
    constructor() {
        this.socket = io();
        this.roomId = null;
        this.playerIndex = null; // 0 or 1
        this.playersInfo = []; // [{name, id}, {name, id}]
        this.currentPlayer = 0;
        this.gameStarted = false;
        this.board = Array(15).fill().map(() => Array(15).fill(0));
        this.resizeTimeout = null;
        this.lastMove = null;
        
        this.moveCountSinceLastCard = 0; // 記錄上次發牌後的步數
        this.myCards = [];
        this.opponentCardCount = 0;
        this.obstacles = [];
        this.traps = []; // [{row, col, playerId (who placed it)}]
        this.cardEffectInProgress = false;
        this.pendingCardUse = null; // { card: obj, cardIndex: num, type: 'trap'/'obstacle'/... }
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketListeners();
        this.drawBoard(); // Initial draw of empty board
    }
    
    initializeElements() {
        this.menu = document.getElementById('menu');
        this.gameArea = document.getElementById('gameArea');
        this.playerNameInput = document.getElementById('playerName');
        this.roomIdInput = document.getElementById('roomId');
        this.roomIdGroup = document.getElementById('roomIdGroup');
        
        this.createRoomBtn = document.getElementById('createRoomBtn');
        this.joinRoomBtn = document.getElementById('joinRoomBtn');
        this.confirmJoinBtn = document.getElementById('confirmJoinBtn');
        this.restartBtn = document.getElementById('restartBtn');
        this.backToMenuBtn = document.getElementById('backToMenuBtn');
        
        this.canvas = document.getElementById('gameBoard');
        this.ctx = this.canvas.getContext('2d');
        this.currentRoomIdDisplay = document.getElementById('currentRoomId'); // Renamed for clarity
        this.gameStatus = document.getElementById('gameStatus');
        this.player0Display = document.getElementById('player0'); // Renamed
        this.player1Display = document.getElementById('player1'); // Renamed
        
        this.createCardUI();
    }
    
    createCardUI() {
        const cardArea = document.createElement('div');
        cardArea.id = 'cardArea';
        cardArea.style.cssText = `
            position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.7); padding: 10px; border-radius: 8px;
            display: none; z-index: 1000; border: 1px solid #555;
        `;
        
        cardArea.innerHTML = `
            <div style="color: white; margin-bottom: 8px; text-align: center; font-size: 14px;">
                我的卡牌 (<span id="myCardCount">0</span>)
            </div>
            <div id="cardList" style="display: flex; gap: 8px; justify-content: center;"></div>
            <div style="color: #bbb; margin-top: 8px; text-align: center; font-size: 12px;">
                對手卡牌: <span id="opponentCardsCount">${this.opponentCardCount}</span>
            </div>
        `;
        document.body.appendChild(cardArea);
        this.cardArea = cardArea;
        this.cardList = document.getElementById('cardList');
        this.myCardCountSpan = document.getElementById('myCardCount');
        this.opponentCardsCountSpan = document.getElementById('opponentCardsCount');
        
        const effectArea = document.createElement('div');
        effectArea.id = 'effectArea';
        effectArea.style.cssText = `
            position: fixed; top: 10px; right: 10px; background: rgba(30,30,30,0.85);
            color: white; padding: 10px 15px; border-radius: 5px; max-width: 280px;
            display: none; z-index: 1001; border: 1px solid #007bff; font-size: 14px;
        `;
        document.body.appendChild(effectArea);
        this.effectArea = effectArea;
    }
    
    getCardDefinitions() {
        return {
            'convert': { name: '棋子轉化', description: '選擇對方一個棋子轉化為我方 (不能因此直接獲勝)。', icon: '🔄' },
            'obstacle': { name: '障礙設置', description: '在棋盤空位放置一個障礙物。', icon: '🚧' },
            'storm': { name: '棋盤風暴', description: '隨機移動場上3-5顆棋子到其他空位。', icon: '🌪️' },
            'undo': { name: '悔棋', description: '取消你或對方的上一步落子，你重新下棋。', icon: '↩️' },
            'trap': { name: '陷阱佈置', description: '秘密選擇一個空位，對方下在此處棋子移除且跳過回合。', icon: '🕳️' },
            'hint': { name: '神機妙算', description: '系統高亮一個建議的落子點。', icon: '💡' },
            'peek': { name: '窺探虛實', description: '隨機查看對方一張卡牌的類型。', icon: '👁️' }
        };
    }
    
    setupEventListeners() {
        this.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.joinRoomBtn.addEventListener('click', () => this.showJoinRoomInput());
        this.confirmJoinBtn.addEventListener('click', () => this.joinRoom());
        this.restartBtn.addEventListener('click', () => this.requestRestartGame());
        this.backToMenuBtn.addEventListener('click', () => this.goBackToMenu());
        
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        
        this.playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && this.menu.style.display !== 'none') { // Only if menu is active
                 if (this.roomIdGroup.style.display === 'block') this.joinRoom();
                 else this.createRoom();
            }
        });
        this.roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.drawBoard(), 250);
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.cardEffectInProgress) {
                this.cancelCardEffectSelection();
            }
        });
    }
    
    setupSocketListeners() {
        this.socket.on('roomCreated', (data) => {
            this.roomId = data.roomId;
            this.playerIndex = data.playerIndex;
            this.showGameInterface();
            this.updateRoomIdDisplay();
            this.gameStatus.textContent = '等待其他玩家加入...';
            this.playersInfo[0] = { name: this.playerNameInput.value.trim() || '玩家1', id: this.socket.id };
            this.updatePlayersDisplay();
        });
        
        this.socket.on('roomJoined', (data) => {
            this.roomId = data.roomId;
            this.playerIndex = data.playerIndex;
            this.showGameInterface();
            this.updateRoomIdDisplay();
             if (this.playerIndex === 1 && this.playersInfo.length >0 && !this.playersInfo[1]) { // If I am player 1 and my info is not set
                this.playersInfo[1] = { name: this.playerNameInput.value.trim() || '玩家2', id: this.socket.id };
            }
        });
        
        this.socket.on('playerJoined', (data) => { // Server sends all players
            this.playersInfo = data.players.map(p => ({ name: p.name, id: p.id }));
            this.updatePlayersDisplay();
        });
        
        this.socket.on('gameStart', (data) => {
            this.gameStarted = true;
            this.currentPlayer = data.currentPlayer;
            this.playersInfo = data.players.map(p => ({ name: p.name, id: p.id })); // Ensure names are fresh
            this.board = data.board || Array(15).fill().map(() => Array(15).fill(0));
            this.myCards = data.myCards ? (data.myCards[this.playerIndex] || []) : [];
            this.opponentCardCount = data.myCards ? (data.myCards[1-this.playerIndex]?.length || 0) : (data.opponentCardCount || 0);
            this.obstacles = data.obstacles || [];
            this.traps = data.traps || [];
            this.lastMove = null;
            this.moveCountSinceLastCard = 0;

            this.updatePlayersDisplay();
            this.updateGameStatusDisplay();
            this.updateCardUI();
            this.drawBoard();
            this.cardArea.style.display = 'block';
            this.restartBtn.style.display = 'none';
            this.showNotification(`遊戲開始！${this.playersInfo[this.currentPlayer].name} 先手。`, 'info');

        });

        this.socket.on('moveMade', (data) => {
            this.board = data.board; // Trust server's board state
            this.currentPlayer = data.currentPlayer;
            this.lastMove = { row: data.row, col: data.col, playerIndex: data.player };
            
            this.moveCountSinceLastCard++;
            if (this.moveCountSinceLastCard >= 3 && this.myCards.length < 5) { // Get card every 3 moves
                this.socket.emit('requestCard', { roomId: this.roomId });
                this.moveCountSinceLastCard = 0;
            }
            
            this.drawBoard();
            this.updateGameStatusDisplay();
        });

        this.socket.on('trapTriggered', (data) => {
            this.board = data.board;
            this.currentPlayer = data.currentPlayer;
            this.traps = this.traps.filter(trap =>
                !data.removedTraps.some(rt => rt.row === trap.row && rt.col === trap.col)
            ); // Update local traps based on what server removed

            const victimName = this.playersInfo[data.victimPlayerIndex]?.name || '玩家';
            const trapperName = this.playersInfo.find(p=>p.id === data.byPlayerId)?.name || '對手';
            
            this.showNotification(`${victimName} 踩中了 ${trapperName} 的陷阱！棋子被移除，回合跳過。`, 'warning');
            this.lastMove = { row: data.row, col: data.col, playerIndex: data.victimPlayerIndex, isTrap: true }; // Mark last move as trap
            this.drawBoard();
            this.updateGameStatusDisplay();
        });
        
        this.socket.on('cardReceived', (data) => {
            // Server sends this only to the player who received the card
            if (data.playerIndex === this.playerIndex) {
                this.myCards.push(data.card);
                this.updateCardUI();
                const cardDef = this.getCardDefinitions()[data.card.type];
                this.showNotification(`獲得卡牌: ${cardDef.name}`, 'success');
            }
        });

        this.socket.on('opponentCardCountUpdate', (data) => {
            // Server sends this when opponent gets a card
            this.opponentCardCount = data.count;
            this.updateCardUI();
        });
        
        this.socket.on('cardUsed', (data) => { // Server confirms card was successfully used
            this.handleCardEffectVisualization(data); // Separate visualization from state update
            
            // Update game state based on server data
            if (data.board) this.board = data.board;
            if (data.obstacles) this.obstacles = data.obstacles;
            if (data.traps) this.traps = data.traps;
            if (typeof data.currentPlayer === 'number') this.currentPlayer = data.currentPlayer;


            if (data.playerId === this.playerIndex) {
                // Card was successfully used, remove from my hand using original index
                this.myCards.splice(data.cardIndex, 1);
            } else {
                this.opponentCardCount--; // Opponent used a card
            }
            
            this.updateCardUI();
            this.drawBoard();
            this.updateGameStatusDisplay(); // Current player might have changed
        });

        this.socket.on('cardUsedOnYou', (data) => { // e.g. opponent peeked your card
            if (data.type === 'peek') {
                this.showNotification(`${data.byPlayerName} 窺探到你的一張卡牌！`, 'info');
            }
        });

        this.socket.on('turnChange', (data) => {
            this.currentPlayer = data.currentPlayer;
            this.updateGameStatusDisplay();
        });
        
        this.socket.on('gameEnd', (data) => {
            this.board = data.board;
            this.drawBoard(); // Draw final board state
            this.gameStatus.textContent = `遊戲結束！${data.winnerName} 獲勝！`;
            this.showNotification(`遊戲結束！${data.winnerName} 獲勝！`, 'event');
            this.restartBtn.style.display = 'inline-block';
            this.gameStarted = false;
            this.cardArea.style.display = 'none';
        });
        
        this.socket.on('gameRestart', (data) => {
            this.board = data.board;
            this.currentPlayer = data.currentPlayer;
            this.myCards = data.myCards ? (data.myCards[this.playerIndex] || []) : [];
            this.opponentCardCount = data.myCards ? (data.myCards[1-this.playerIndex]?.length || 0) : (data.opponentCardCount || 0);
            this.obstacles = data.obstacles || [];
            this.traps = data.traps || [];
            this.lastMove = null;
            this.moveCountSinceLastCard = 0;
            this.gameStarted = true;

            this.drawBoard();
            this.updateGameStatusDisplay();
            this.updateCardUI();
            this.restartBtn.style.display = 'none';
            this.cardArea.style.display = 'block';
            this.showNotification('遊戲已重新開始！', 'info');
        });
        
        this.socket.on('playerLeft', (data) => {
            const leftPlayer = this.playersInfo.find(p => p.id === data.playerId);
            this.playersInfo = data.players; // Update with remaining players
            this.updatePlayersDisplay();
            this.gameStatus.textContent = `${leftPlayer ? leftPlayer.name : '對手'} 已離開遊戲。等待其他玩家...`;
            this.showNotification(`${leftPlayer ? leftPlayer.name : '對手'} 已離開。`, 'warning');
            this.gameStarted = false;
            this.cardArea.style.display = 'none';
            this.restartBtn.style.display = 'none'; // Or allow restart if one player wants to wait
        });

        this.socket.on('opponentLeftGame', (data) => {
            this.gameStatus.textContent = data.message;
            this.showNotification(data.message, 'warning');
            this.gameStarted = false; // Pause the game
            // Optionally, hide opponent card count or show "Waiting for opponent"
            this.player1Display.querySelector('.player-name').textContent = '等待對手...';
            this.player1Display.classList.remove('active');
        });
        
        this.socket.on('error', (data) => {
            console.error('Server error:', data.message);
            this.showNotification(`錯誤: ${data.message}`, 'error');
            // If a card effect was in progress and failed, reset UI
            if (this.cardEffectInProgress) {
                this.cancelCardEffectSelection();
            }
        });
    }

    // --- UI Update Functions ---
    showNotification(message, type = 'info') { // type: 'info', 'success', 'error', 'warning', 'event'
        const notification = document.createElement('div');
        let bgColor = '#333';
        switch(type) {
            case 'success': bgColor = '#4CAF50'; break;
            case 'error': bgColor = '#f44336'; break;
            case 'warning': bgColor = '#ff9800'; break;
            case 'event': bgColor = '#2196F3'; break;
        }
        notification.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background-color: ${bgColor}; color: white; padding: 12px 20px; border-radius: 5px;
            font-size: 14px; z-index: 2000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            opacity: 0; transition: opacity 0.5s, top 0.5s;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.opacity = '1';
            notification.style.top = '30px';
        }, 10);

        // Animate out and remove
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.top = '0px';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 500);
        }, type === 'error' ? 4000 : 3000);
    }
    
    updateCardUI() {
        this.cardList.innerHTML = '';
        const cardDefs = this.getCardDefinitions();
        
        this.myCards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            const cardDef = cardDefs[card.type];
            if (!cardDef) {
                console.error("Undefined card type in myCards:", card);
                return; // Skip rendering this card
            }
            cardElement.className = 'game-card'; // Add a class for styling
            cardElement.style.cssText = `
                background: linear-gradient(135deg, #5A5A5A, #3A3A3A); color: white;
                padding: 8px; border-radius: 6px; cursor: pointer; text-align: center;
                min-width: 70px; border: 1px solid #777; transition: transform 0.2s, box-shadow 0.2s;
                user-select: none; display: flex; flex-direction: column; align-items: center; justify-content: center;
            `;
            
            cardElement.innerHTML = `
                <div style="font-size: 22px; margin-bottom: 3px;">${cardDef.icon}</div>
                <div style="font-size: 11px; font-weight: bold; white-space: nowrap;">${cardDef.name}</div>
            `;
            
            cardElement.addEventListener('mouseenter', () => {
                if (!this.cardEffectInProgress) {
                    cardElement.style.transform = 'translateY(-4px)';
                    cardElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
                    this.showCardTooltip(cardElement, cardDef.name, cardDef.description);
                }
            });
            cardElement.addEventListener('mouseleave', () => {
                cardElement.style.transform = 'translateY(0)';
                cardElement.style.boxShadow = 'none';
                this.hideCardTooltip();
            });
            
            cardElement.addEventListener('click', () => {
                this.hideCardTooltip();
                if (this.gameStarted && this.currentPlayer === this.playerIndex && !this.cardEffectInProgress) {
                    this.initiateCardUse(card, index);
                } else if (this.currentPlayer !== this.playerIndex) {
                    this.showNotification("不是你的回合！", "error");
                } else if (this.cardEffectInProgress) {
                    this.showNotification("正在选择卡牌目标...", "info");
                }
            });
            this.cardList.appendChild(cardElement);
        });
        
        this.myCardCountSpan.textContent = this.myCards.length;
        this.opponentCardsCountSpan.textContent = this.opponentCardCount;

        if (this.myCards.length > 0 && this.gameStarted) {
            this.cardArea.style.display = 'block';
        } else if (!this.gameStarted && this.myCards.length === 0) {
             this.cardArea.style.display = 'none';
        }
    }
    
    showCardTooltip(element, name, description) {
        this.hideCardTooltip(); // Remove any existing tooltip
        const tooltip = document.createElement('div');
        tooltip.id = 'cardTooltip';
        tooltip.style.cssText = `
            position: absolute; background: rgba(0,0,0,0.9); color: white; padding: 8px 12px;
            border-radius: 4px; font-size: 13px; z-index: 3000; pointer-events: none;
            max-width: 200px; text-align: left;
        `;
        tooltip.innerHTML = `<strong style="display:block; margin-bottom:3px;">${name}</strong>${description}`;
        
        document.body.appendChild(tooltip);
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltipRect.width / 2)}px`;
        tooltip.style.top = `${rect.top - tooltipRect.height - 10}px`; // 10px offset
    }
    
    hideCardTooltip() {
        const tooltip = document.getElementById('cardTooltip');
        if (tooltip && tooltip.parentElement) {
            tooltip.parentElement.removeChild(tooltip);
        }
    }

    // --- Card Logic ---
    initiateCardUse(card, cardIndex) {
        this.pendingCardUse = { card: card, cardIndex: cardIndex, type: card.type };

        switch (card.type) {
            case 'convert':
            case 'obstacle':
            case 'trap':
                this.cardEffectInProgress = true;
                const typeMap = {'convert': '轉換目標棋子', 'obstacle': '放置障礙物', 'trap': '佈置陷阱'};
                this.showEffectMessage(`選擇棋盤位置以${typeMap[card.type]} (按ESC取消)`);
                this.canvas.style.cursor = 'crosshair';
                break;
            case 'storm':
            case 'undo': // Undo needs server's last move, client doesn't pick target
            case 'hint': // Hint can be automatic
            case 'peek': // Peek is automatic
                // These cards are used directly without board interaction from player
                this.socket.emit('useCard', {
                    roomId: this.roomId,
                    cardIndex: cardIndex
                    // No 'target' needed from client for these, server handles or it's not applicable
                });
                this.pendingCardUse = null; // Reset as it's sent
                break;
            default:
                console.error("Unknown card type for initiation:", card.type);
                this.pendingCardUse = null;
        }
    }

    handleCardEffectVisualization(data) {
        // This function is for visual feedback of card effects
        const cardDef = this.getCardDefinitions()[data.card.type];
        const playerName = data.playerName || (this.playersInfo[data.playerId]?.name || '玩家');

        let message = `${playerName} 使用了 ${cardDef.name}！`;

        switch (data.effect) { // 'effect' is card.type from server
            case 'convert':
                message += ` 棋子 (${data.target.row}, ${data.target.col}) 已轉化。`;
                this.highlightPosition(data.target.row, data.target.col, '#00FF00', 2000);
                break;
            case 'obstacle':
                message += ` 障礙物已放置於 (${data.target.row}, ${data.target.col})。`;
                this.highlightPosition(data.target.row, data.target.col, '#FF0000', 2000);
                break;
            case 'storm':
                message += ` ${data.moved.length}顆棋子被風暴移動了！`;
                data.moved.forEach(move => {
                    this.highlightPosition(move.to.row, move.to.col, '#FFFF00', 1000 + Math.random()*1000);
                });
                break;
            case 'undo':
                message += ` 上一步棋 (${data.undoneMove.row}, ${data.undoneMove.col}) 已撤銷。`;
                this.highlightPosition(data.undoneMove.row, data.undoneMove.col, '#FFA500', 2000);
                if (data.playerId === this.playerIndex) {
                    message += " 輪到你重新下棋。";
                }
                break;
            case 'trap':
                if (data.playerId === this.playerIndex) {
                     message += ` 陷阱已佈置於 (${data.target.row}, ${data.target.col})。`;
                } else {
                     message += ` 對方佈置了一個陷阱！`; // Don't reveal location
                }
                break;
            case 'hint':
                if (data.playerId === this.playerIndex && data.hintTarget) {
                    message = `提示：考慮 (${data.hintTarget.row}, ${data.hintTarget.col})。`;
                    this.highlightPosition(data.hintTarget.row, data.hintTarget.col, '#00FFFF', 3000);
                } else if (data.playerId === this.playerIndex) {
                    message = `你使用了${cardDef.name}，但暫無明顯提示。`;
                } else {
                     message = `${playerName} 使用了 ${cardDef.name}。`;
                }
                break;
            case 'peek':
                if (data.playerId === this.playerIndex) {
                    if (data.peekType) {
                        const peekedCardDef = this.getCardDefinitions()[data.peekType];
                        message = `窺探到對手卡牌: ${peekedCardDef.name} (${peekedCardDef.icon})。`;
                    } else {
                        message = `窺探：對手沒有卡牌或無對手。`;
                    }
                } else {
                    // This case is handled by 'cardUsedOnYou' for the other player
                    return; // Don't show notification for opponent using peek here
                }
                break;
        }
        this.showNotification(message, 'event');
    }
    
    highlightPosition(row, col, color = '#FFD700', duration = 2000) {
        const x = 20 + col * 40;
        const y = 20 + row * 40;
        const radius = 20;
        let blink = true;
        
        const intervalId = setInterval(() => {
            this.drawBoard(); // Redraw base board
            if (blink) {
                this.ctx.beginPath();
                this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }
            blink = !blink;
        }, 300);
        
        setTimeout(() => {
            clearInterval(intervalId);
            this.drawBoard(); // Final redraw to remove highlight
        }, duration);
    }

    showEffectMessage(message) {
        this.effectArea.textContent = message;
        this.effectArea.style.display = 'block';
    }
    
    finishCardEffectSelection() {
        this.cardEffectInProgress = false;
        this.pendingCardUse = null;
        this.canvas.style.cursor = 'default';
        this.effectArea.style.display = 'none';
    }

    cancelCardEffectSelection() {
        this.finishCardEffectSelection();
        this.showNotification('卡牌目標選擇已取消', 'info');
    }
    
    // --- Game Flow & UI ---
    createRoom() {
        const playerName = this.playerNameInput.value.trim();
        if (!playerName) {
            this.showNotification('請輸入玩家名稱', 'error');
            return;
        }
        this.socket.emit('createRoom', { playerName });
    }
    
    showJoinRoomInput() { // Renamed for clarity
        this.roomIdGroup.style.display = 'block';
        this.joinRoomBtn.style.display = 'none'; // Hide "Join Room" text, show input + confirm
        this.confirmJoinBtn.style.display = 'inline-block';
    }
    
    joinRoom() {
        const playerName = this.playerNameInput.value.trim();
        const roomId = this.roomIdInput.value.trim().toUpperCase();
        
        if (!playerName) {
            this.showNotification('請輸入玩家名稱', 'error');
            return;
        }
        if (!roomId) {
            this.showNotification('請輸入房間號', 'error');
            return;
        }
        this.socket.emit('joinRoom', { playerName, roomId });
    }
    
    requestRestartGame() { // Renamed
        this.socket.emit('restartGame', { roomId: this.roomId });
    }
    
    goBackToMenu() { // Renamed
        this.menu.style.display = 'block';
        this.gameArea.style.display = 'none';
        this.cardArea.style.display = 'none';
        this.effectArea.style.display = 'none';
        
        this.roomIdGroup.style.display = 'none';
        this.joinRoomBtn.style.display = 'inline-block';
        this.confirmJoinBtn.style.display = 'none';
        this.restartBtn.style.display = 'none';
        
        //this.playerNameInput.value = ''; // Keep player name for convenience
        this.roomIdInput.value = '';
        
        // Soft reset of client state, server will send full state on rejoin/new game
        this.roomId = null;
        this.playerIndex = null;
        this.gameStarted = false;
        this.board = Array(15).fill().map(() => Array(15).fill(0));
        this.myCards = [];
        this.opponentCardCount = 0;
        this.obstacles = [];
        this.traps = [];
        this.playersInfo = [];
        this.cancelCardEffectSelection(); // Ensure any pending card UI is cleared
        this.drawBoard(); // Draw empty board
        this.updateCardUI();
        this.updatePlayersDisplay();
        this.gameStatus.textContent = "歡迎來到五子棋！";
        // Disconnect and reconnect if you want a full state reset from server perspective,
        // or rely on server to handle player leaving a room.
        // For now, this is a client-side UI reset.
    }
    
    showGameInterface() { // Renamed
        this.menu.style.display = 'none';
        this.gameArea.style.display = 'block';
    }
    
    updateRoomIdDisplay() {
        this.currentRoomIdDisplay.textContent = this.roomId || 'N/A';
    }
    
    updatePlayersDisplay() {
        const p0NameEl = this.player0Display.querySelector('.player-name');
        const p1NameEl = this.player1Display.querySelector('.player-name');

        p0NameEl.textContent = this.playersInfo[0] ? this.playersInfo[0].name : '等待玩家...';
        p1NameEl.textContent = this.playersInfo[1] ? this.playersInfo[1].name : '等待玩家...';

        this.player0Display.classList.toggle('active', this.gameStarted && this.currentPlayer === 0);
        this.player1Display.classList.toggle('active', this.gameStarted && this.currentPlayer === 1);
    }
    
    updateGameStatusDisplay() {
        if (!this.gameStarted) {
            if (this.roomId && this.playersInfo.length < 2) {
                this.gameStatus.textContent = '等待其他玩家加入...';
            } else if (!this.roomId) {
                 this.gameStatus.textContent = "歡迎！創建或加入房間以開始。";
            }
            return;
        }
        
        this.updatePlayersDisplay(); // Also updates active player highlight

        if (this.currentPlayer === this.playerIndex) {
            this.gameStatus.textContent = '輪到你下棋了！';
        } else {
            const currentTurnPlayerName = this.playersInfo[this.currentPlayer]?.name || '對手';
            this.gameStatus.textContent = `等待 ${currentTurnPlayerName} 下棋...`;
        }
    }
    
    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        const col = Math.round((x - 20) / 40);
        const row = Math.round((y - 20) / 40);

        if (row < 0 || row > 14 || col < 0 || col > 14) return; // Click outside board

        if (this.cardEffectInProgress && this.pendingCardUse) {
            const cardType = this.pendingCardUse.type;
            if (cardType === 'convert' || cardType === 'obstacle' || cardType === 'trap') {
                let canPlace = true;
                let reason = "";
                if (this.board[row][col] !== 0 && cardType !== 'convert') {
                     canPlace = false; reason = "此處已有棋子！";
                }
                if (this.board[row][col] === 0 && cardType === 'convert') {
                    canPlace = false; reason = "此處沒有棋子可轉化！";
                }
                if (this.board[row][col] !== 0 && this.board[row][col] === (this.playerIndex + 1) && cardType === 'convert'){
                    canPlace = false; reason = "不能轉化自己的棋子！";
                }
                if (this.obstacles.some(obs => obs.row === row && obs.col === col)) {
                    canPlace = false; reason = "此處是障礙物！";
                }
                if (this.traps.some(t => t.row === row && t.col === col) && cardType === 'trap') {
                     canPlace = false; reason = "此處已有陷阱！";
                }


                if (canPlace) {
                    this.socket.emit('useCard', {
                        roomId: this.roomId,
                        cardIndex: this.pendingCardUse.cardIndex,
                        target: { row, col } // Server will validate if this target is appropriate for card type
                    });
                    this.finishCardEffectSelection();
                } else {
                    this.showNotification(reason, "error");
                }
            }
            return; // Don't process as a normal move
        }
        
        if (!this.gameStarted || this.currentPlayer !== this.playerIndex) {
            return;
        }
        
        if (this.board[row][col] === 0 && !this.obstacles.some(obs => obs.row === row && obs.col === col)) {
            this.socket.emit('makeMove', { roomId: this.roomId, row, col });
        } else if (this.board[row][col] !== 0) {
            this.showNotification("此處已有棋子！", "error");
        } else if (this.obstacles.some(obs => obs.row === row && obs.col === col)) {
            this.showNotification("不能在障礙物上下棋！", "error");
        }
    }
    
    drawBoard() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#deb887'; // Board color
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.strokeStyle = '#333'; // Line color
        this.ctx.lineWidth = 1;
        for (let i = 0; i < 15; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(20 + i * 40, 20);
            this.ctx.lineTo(20 + i * 40, 580); // 20 + 14*40
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(20, 20 + i * 40);
            this.ctx.lineTo(580, 20 + i * 40);
            this.ctx.stroke();
        }
        
        const starPoints = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
        this.ctx.fillStyle = '#000';
        starPoints.forEach(([r, c]) => {
            this.ctx.beginPath();
            this.ctx.arc(20 + c * 40, 20 + r * 40, 4, 0, 2 * Math.PI);
            this.ctx.fill();
        });

        this.obstacles.forEach(obs => {
            const x = 20 + obs.col * 40;
            const y = 20 + obs.row * 40;
            this.ctx.fillStyle = '#7A7A7A'; // Obstacle color
            this.ctx.fillRect(x - 18, y - 18, 36, 36); // Slightly smaller than cell
            this.ctx.strokeStyle = '#555';
            this.ctx.strokeRect(x - 18, y - 18, 36, 36);
            this.ctx.font = '20px Arial';
            this.ctx.fillStyle = '#EEE';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('🚧', x, y);
        });
        
        this.traps.forEach(trap => {
            if (trap.playerId === this.playerIndex) { // Only show my traps
                const x = 20 + trap.col * 40;
                const y = 20 + trap.row * 40;
                this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                this.ctx.beginPath();
                this.ctx.arc(x, y, 10, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.font = '12px Arial';
                this.ctx.fillStyle = 'red';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('🕳️', x, y + 4);
            }
        });

        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                if (this.board[r][c] !== 0) {
                    const x = 20 + c * 40;
                    const y = 20 + r * 40;
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, 18, 0, 2 * Math.PI);
                    this.ctx.fillStyle = this.board[r][c] === 1 ? '#000' : '#FFF';
                    this.ctx.fill();
                    this.ctx.strokeStyle = this.board[r][c] === 1 ? '#333' : '#CCC';
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();

                    if (this.lastMove && this.lastMove.row === r && this.lastMove.col === c) {
                        this.ctx.strokeStyle = this.lastMove.isTrap ? '#0000FF' : '#FF0000'; // Blue for trap, Red for normal
                        this.ctx.lineWidth = 2;
                        this.ctx.strokeRect(x - 19, y - 19, 38, 38); // Square highlight
                    }
                }
            }
        }
    }
}

const game = new GomokuGame();

const chatbox = document.getElementById('chatbox');
const chatboxHeader = document.getElementById('chatbox-toggle');
const chatboxMessages = document.getElementById('chatbox-messages');
const chatboxInput = document.getElementById('chatbox-input');
const chatboxSend = document.getElementById('chatbox-send');
let chatboxOpen = true;

chatboxHeader.addEventListener('click', () => {
  chatboxOpen = !chatboxOpen;
  chatboxMessages.style.display = chatboxOpen ? 'block' : 'none';
  document.querySelector('.chatbox-input-area').style.display = chatboxOpen ? 'flex' : 'none';
  chatboxHeader.textContent = chatboxOpen ? '聊天室 ▼' : '聊天室 ▲';
});

chatboxSend.addEventListener('click', sendChatMessage);
chatboxInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const msg = chatboxInput.value.trim();
  if (!msg) return;
  game.socket.emit('chatMessage', { roomId: game.roomId, name: game.playerNameInput.value, message: msg });
  chatboxInput.value = '';
}
