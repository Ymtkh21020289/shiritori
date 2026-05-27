const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ゲームの状態管理
let gameState = {
    players: [], // { id, name, score, isConnected }
    status: 'waiting', // waiting, playing, finished
    mode: '10turns', // 10turns or 15points
    currentWord: 'しりとり',
    usedWords: ['しりとり'],
    turnIndex: 0,
    roundCount: 1,
    timer: 30,
    finalRoundTriggered: false,
    finalRoundStartPlayerIndex: -1
};

let timerInterval;

// 文字列の重なりを計算する関数
function calculateOverlap(prevWord, newWord) {
    let maxOverlap = 0;
    const minLength = Math.min(prevWord.length, newWord.length);
    for (let i = 1; i <= minLength; i++) {
        if (prevWord.slice(-i) === newWord.slice(0, i)) {
            maxOverlap = i;
        }
    }
    return maxOverlap;
}

// 辞書APIで単語の存在確認 (キー不要のjisho.org APIを使用)
async function isValidWord(word) {
    try {
        const response = await axios.get(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`);
        const readings = response.data.japanese
        return readings[0].reading == word;
    } catch (error) {
        console.error("API Error:", error);
        return false;
    }
}

function nextTurn() {
    clearInterval(timerInterval);
    
    // 15点モードの終了判定確認
    if (gameState.mode === '15points' && gameState.finalRoundTriggered) {
        if ((gameState.turnIndex + 1) % gameState.players.length === gameState.finalRoundStartPlayerIndex) {
            endGame();
            return;
        }
    }

    gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    
    // 1周したらラウンドを進める（10ターンモード用）
    if (gameState.turnIndex === 0) {
        gameState.roundCount++;
    }

    // 10ターンモードの終了判定 (10ラウンド終了時)
    if (gameState.mode === '10turns' && gameState.roundCount > 10) {
        endGame();
        return;
    }

    startTimer();
    io.emit('update_state', gameState);
}

function startTimer() {
    gameState.timer = 30;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        gameState.timer--;
        io.emit('update_timer', gameState.timer);
        if (gameState.timer <= 0) {
            io.emit('system_message', `時間切れです！次のプレイヤーの番になります。`);
            nextTurn();
        }
    }, 1000);
}

function endGame() {
    clearInterval(timerInterval);
    gameState.status = 'finished';
    
    // 勝者判定
    let maxScore = -1;
    let winners = [];
    gameState.players.forEach(p => {
        if (p.score > maxScore) {
            maxScore = p.score;
            winners = [p.name];
        } else if (p.score === maxScore) {
            winners.push(p.name);
        }
    });

    io.emit('update_state', gameState);
    io.emit('game_over', { winners, maxScore });
}

io.on('connection', (socket) => {
    socket.on('join', (name) => {
        if (gameState.status !== 'waiting') {
            socket.emit('error_message', '現在ゲーム進行中です。');
            return;
        }
        gameState.players.push({ id: socket.id, name: name, score: 0 });
        io.emit('update_state', gameState);
    });

    socket.on('start_game', (mode) => {
        if (gameState.players.length < 2) return;
        gameState.status = 'playing';
        gameState.mode = mode;
        gameState.currentWord = 'しりとり';
        gameState.usedWords = ['しりとり'];
        gameState.turnIndex = 0;
        gameState.roundCount = 1;
        gameState.finalRoundTriggered = false;
        gameState.players.forEach(p => p.score = 0);
        
        io.emit('update_state', gameState);
        io.emit('system_message', 'ゲーム開始！最初の単語は「しりとり」です。');
        startTimer();
    });

    socket.on('submit_word', async (word) => {
        const player = gameState.players[gameState.turnIndex];
        if (socket.id !== player.id || gameState.status !== 'playing') return;

        // ひらがなチェック
        if (!/^[ぁ-んー]+$/.test(word)) {
            socket.emit('error_message', 'ひらがなのみで入力してください。');
            return; // お手付きは無制限なのでターンは進めない
        }

        // 使用済みチェック
        if (gameState.usedWords.includes(word)) {
            socket.emit('error_message', 'すでに使われた単語です。');
            return;
        }

        // しりとり繋がりチェック
        const overlapCount = calculateOverlap(gameState.currentWord, word);
        if (overlapCount === 0) {
            socket.emit('error_message', '前の単語と繋がっていません。');
            return;
        }

        // 単語存在チェック
        const isValid = await isValidWord(word);
        if (!isValid) {
            socket.emit('error_message', '辞書に存在しない単語です。');
            return;
        }

        // 正解処理
        player.score += overlapCount;
        gameState.currentWord = word;
        gameState.usedWords.push(word);
        io.emit('system_message', `${player.name}が「${word}」を入力し、${overlapCount}pt獲得！`);

        // 15点モードの特殊ルール判定
        if (gameState.mode === '15points' && !gameState.finalRoundTriggered && player.score >= 15) {
            gameState.finalRoundTriggered = true;
            gameState.finalRoundStartPlayerIndex = gameState.turnIndex;
            io.emit('system_message', `【ラストターン突入】${player.name}が15点に到達しました！他のプレイヤーは最後のターンになります！`);
        }

        nextTurn();
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        if (gameState.players.length < 2 && gameState.status === 'playing') {
            endGame();
            io.emit('system_message', 'プレイヤーが切断されたため、ゲームを終了します。');
            gameState.status = 'waiting';
        }
        io.emit('update_state', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
