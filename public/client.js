const socket = io();

let myId = null;

socket.on('connect', () => {
    myId = socket.id;
});

function joinGame() {
    const name = document.getElementById('player-name').value;
    if (!name) return;
    socket.emit('join', name);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
}

function startGame() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    socket.emit('start_game', mode);
}

function submitWord() {
    const word = document.getElementById('word-input').value;
    if (!word) return;
    document.getElementById('error-msg').innerText = ''; // エラーリセット
    socket.emit('submit_word', word);
    document.getElementById('word-input').value = '';
}

// Enterキーで送信
document.getElementById('word-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') submitWord();
});

socket.on('update_state', (state) => {
    if (state.status === 'waiting') {
        document.getElementById('lobby-screen').style.display = 'block';
        document.getElementById('game-screen').style.display = 'none';
        
        const lobbyList = document.getElementById('player-list-lobby');
        lobbyList.innerHTML = '';
        state.players.forEach(p => {
            lobbyList.innerHTML += `<li>${p.name}</li>`;
        });
        
        document.getElementById('start-btn').disabled = state.players.length < 2;
    } else if (state.status === 'playing') {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
        
        document.getElementById('round-display').innerText = state.roundCount;
        document.getElementById('current-word').innerText = state.currentWord;
        
        const activePlayer = state.players[state.turnIndex];
        const isMyTurn = activePlayer.id === myId;
        
        document.getElementById('turn-indicator').innerText = isMyTurn ? 'あなたの番です！' : `${activePlayer.name}の番です...`;
        document.getElementById('word-input').disabled = !isMyTurn;
        document.getElementById('submit-btn').disabled = !isMyTurn;

        const scoreList = document.getElementById('player-scores');
        scoreList.innerHTML = '';
        state.players.forEach((p, index) => {
            const className = index === state.turnIndex ? 'active-player' : '';
            scoreList.innerHTML += `<li class="${className}">${p.name}: ${p.score} pt</li>`;
        });
    }
});

socket.on('update_timer', (time) => {
    document.getElementById('time-display').innerText = time;
});

socket.on('error_message', (msg) => {
    document.getElementById('error-msg').innerText = msg;
});

socket.on('system_message', (msg) => {
    const log = document.getElementById('game-log');
    log.innerHTML = `<li>[System] ${msg}</li>` + log.innerHTML;
});

socket.on('game_over', (data) => {
    alert(`ゲーム終了！\n勝者: ${data.winners.join(', ')}\nスコア: ${data.maxScore}pt`);
    location.reload(); // 簡単のためリロードして初期状態に戻す
});
