import { Game, difficulties } from './game.js';
import { UIController } from './ui.js';
import { submitScore, fetchLeaderboard, renderLeaderboardList, renderLeaderboardPagination, syncScores, migrateUserScores } from './leaderboard.js';
import { showReplay, hideReplay } from './replay.js';
import { playBackgroundMusic, fadeInMusic, fadeOutMusic, toggleMute } from './audio.js';

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game-canvas');
    let hasInteracted = false;

    const handleFirstInteraction = () => {
        if (!hasInteracted) {
            hasInteracted = true;
            playBackgroundMusic();
        }
    };
    
    // UI Elements
    const elements = {
        scoreDisplay: document.getElementById('score-display'),
        scoreEl: document.getElementById('score'),
        levelDisplay: document.getElementById('level-display'),
        startMenu: document.getElementById('start-menu'),
        gameOverMenu: document.getElementById('game-over-menu'),
        finalScoreEl: document.getElementById('final-score'),
        homeBtn: document.getElementById('home-btn'),
        difficultyBtns: document.querySelectorAll('.difficulty-btn'),
        replayBtn: document.getElementById('replay-btn'),
        replayContainer: document.getElementById('replay-container'),
        closeReplayBtn: document.getElementById('close-replay-btn'),
        submitScoreBtn: document.getElementById('submit-score-btn'),
        leaderboardBtn: document.getElementById('leaderboard-btn'),
        leaderboardView: document.getElementById('leaderboard-view'),
        closeLeaderboardBtn: document.getElementById('close-leaderboard-btn'),
        leaderboardList: document.getElementById('leaderboard-list'),
        leaderboardDifficultyFilters: document.getElementById('leaderboard-difficulty-filters'),
        leaderboardFilterBtns: document.querySelectorAll('.leaderboard-filter-btn'),
        leaderboardPagination: document.getElementById('leaderboard-pagination'),
        musicToggleBtn: document.getElementById('music-toggle-btn'),
        tapToRestart: document.getElementById('tap-to-restart')
    };

    const game = new Game(canvas);
    const ui = new UIController(elements);
    let rankedPlayersData = [];
    let allDifficultiesData = { easy: null, medium: null, hard: null }; // Cache for 'My Scores'
    let isMyScoresActive = false;
    let currentUser = null;
    let replayOrigin = 'gameover'; // 'gameover' or 'leaderboard'
    let leaderboardState = {
        currentPage: 1,
        totalPages: 1,
        itemsPerPage: 10,
        currentDifficulty: 'easy'
    };
    let currentDifficulty = 'easy';

    // Set up game callbacks
    game.onScoreUpdate = (score) => ui.updateScore(score);
    game.onLevelUp = (level, isInitial) => ui.updateLevel(level, isInitial);
    game.onGameOver = (gameData) => {
        ui.showGameOverMenu(gameData.score);
    };

    // Difficulty Selection
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent bubbling to start menu
            handleFirstInteraction(); // Start audio on difficulty select
            const difficulty = btn.dataset.difficulty;
            currentDifficulty = difficulty;
            ui.updateDifficulty(difficulty);
            game.setDifficulty(difficulty); // Update visuals
        });
    });

    // Tap to Start
    elements.startMenu.addEventListener('click', (e) => {
        // Prevent starting if clicking on difficulty buttons (just in case stopPropagation fails or structure changes)
        if (e.target.closest('.difficulty-selector')) return;
        
        handleFirstInteraction();
        game.start(currentDifficulty);
        ui.showGameScreen();
    });

    // Game Over Menu Tap to Restart
    elements.gameOverMenu.addEventListener('click', (e) => {
        // Don't trigger if clicking buttons or interactions inside
        if (e.target.closest('button') || e.target.closest('.difficulty-selector')) return;
        
        // Prevent accidental restart if text is not visible yet
        if (elements.tapToRestart && elements.tapToRestart.style.opacity === '0') return;

        ui.clearTimeouts();
        game.reset();
        ui.showGameScreen();
        game.start(currentDifficulty);
    });

    // Home button
    elements.homeBtn.addEventListener('click', () => {
        ui.clearTimeouts();
        game.reset();
        ui.showStartMenu();
    });

    // Replay button
    elements.replayBtn.addEventListener('click', async () => {
        handleFirstInteraction();
        replayOrigin = 'gameover';
        fadeOutMusic();
        ui.showReplayContainer();
        
        if (!game.replayConfig.currentUser) {
            try {
                const currentUser = await window.websim.getCurrentUser();
                game.replayConfig.currentUser = currentUser;
            } catch (error) {
                console.error("Could not get current user for replay:", error);
                game.replayConfig.currentUser = null;
            }
        }

        showReplay({
            frames: game.replayFrames,
            config: game.replayConfig
        });
    });

    elements.closeReplayBtn.addEventListener('click', () => {
        ui.hideReplayContainer(replayOrigin);
        hideReplay();
        fadeInMusic();
    });

    // Submit score button
    elements.submitScoreBtn.addEventListener('click', async () => {
        ui.setSubmitButtonState('disabled', 'Submitting...');
        
        await submitScore(
            game.lastGameData,
            () => ui.setSubmitButtonState('disabled', 'Submitted!'),
            () => {
                ui.setSubmitButtonState('disabled', 'Error!');
                setTimeout(() => {
                    ui.setSubmitButtonState('enabled', 'Submit Score');
                }, 2000);
            }
        );
    });

    // Music Toggle
    let isMuted = false;
    elements.musicToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Don't trigger game tap
        handleFirstInteraction(); // Ensure audio context is ready
        isMuted = !isMuted;
        toggleMute(isMuted);
        
        const onIcon = elements.musicToggleBtn.querySelector('.volume-on');
        const offIcon = elements.musicToggleBtn.querySelector('.volume-off');
        
        if (isMuted) {
            onIcon.classList.add('hidden');
            offIcon.classList.remove('hidden');
        } else {
            onIcon.classList.remove('hidden');
            offIcon.classList.add('hidden');
        }
    });

    async function updateLeaderboardView() {
        const { currentPage, itemsPerPage } = leaderboardState;
        let dataToRender = rankedPlayersData;
        
        if (isMyScoresActive && currentUser) {
            const myData = rankedPlayersData.find(p => p.username === currentUser.username);
            dataToRender = myData ? [myData] : [];
        }

        elements.leaderboardList.innerHTML = renderLeaderboardList(dataToRender, currentPage, itemsPerPage);
        
        const totalPages = Math.ceil(dataToRender.length / itemsPerPage);
        leaderboardState.totalPages = totalPages;

        if (totalPages > 1) {
            elements.leaderboardPagination.innerHTML = renderLeaderboardPagination(totalPages, currentPage);
            ui.showPagination();
        } else {
            ui.hidePagination();
        }
    }

    async function loadLeaderboard(difficulty) {
        leaderboardState.currentDifficulty = difficulty;
        isMyScoresActive = false; // Reset 'My Scores' view when changing difficulty
        leaderboardState.currentPage = 1;
        
        ui.showLeaderboardView();
        elements.leaderboardList.innerHTML = '<p>Loading scores...</p>';
        ui.hidePagination();
        rankedPlayersData = [];

        // Update active button state
        elements.leaderboardFilterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.difficulty === difficulty);
        });
        document.getElementById('my-scores-btn').classList.remove('active');

        try {
            // Use cached data if available
            if (allDifficultiesData[difficulty]) {
                rankedPlayersData = allDifficultiesData[difficulty];
            } else {
                rankedPlayersData = await fetchLeaderboard(difficulty);
                allDifficultiesData[difficulty] = rankedPlayersData; // Cache it
            }
            
            leaderboardState.totalPages = Math.ceil(rankedPlayersData.length / leaderboardState.itemsPerPage);

            if (rankedPlayersData.length === 0) {
                elements.leaderboardList.innerHTML = `<p>No scores for ${difficulty} difficulty yet. Be the first!</p>`;
                ui.hidePagination();
            } else {
                updateLeaderboardView();
                ui.showPagination();
            }
        } catch (error) {
            console.error("Error fetching leaderboard:", error);
            elements.leaderboardList.innerHTML = '<p>Could not load leaderboard. Please try again later.</p>';
            ui.hidePagination();
        }
    }

    // Leaderboard button
    elements.leaderboardBtn.addEventListener('click', async () => {
        handleFirstInteraction();
        syncScores(); // Sync scores when leaderboard is opened
        loadLeaderboard('easy'); // Default to easy
    });

    elements.leaderboardDifficultyFilters.addEventListener('click', async (e) => {
        const targetBtn = e.target.closest('.leaderboard-filter-btn');
        if (!targetBtn || targetBtn.classList.contains('active')) return;
        
        const difficulty = targetBtn.dataset.difficulty;

        if (difficulty === 'mine') {
            isMyScoresActive = true;
            leaderboardState.currentPage = 1;
            
            // Set active states
            elements.leaderboardFilterBtns.forEach(btn => btn.classList.remove('active'));
            targetBtn.classList.add('active');
            
            if (!currentUser) {
                try {
                    currentUser = await window.websim.getCurrentUser();
                } catch {
                     elements.leaderboardList.innerHTML = `<p>Could not verify user. Please try again.</p>`;
                     return;
                }
            }

            // Load data for current difficulty if not already loaded
            if (!allDifficultiesData[leaderboardState.currentDifficulty]) {
                await loadLeaderboard(leaderboardState.currentDifficulty);
                // After loading, re-apply the "My Scores" filter
                elements.leaderboardFilterBtns.forEach(btn => btn.classList.remove('active'));
                targetBtn.classList.add('active');
            }
            
            updateLeaderboardView();
            
        } else if (!targetBtn.classList.contains('active')) {
            loadLeaderboard(difficulty);
        }
    });

    elements.leaderboardPagination.addEventListener('click', (e) => {
        const target = e.target;
        let pageChanged = false;
        
        if (target.id === 'first-page-btn' && leaderboardState.currentPage > 1) {
            leaderboardState.currentPage = 1;
            pageChanged = true;
        } else if (target.id === 'prev-page-btn' && leaderboardState.currentPage > 1) {
            leaderboardState.currentPage--;
            pageChanged = true;
        } else if (target.id === 'next-page-btn' && leaderboardState.currentPage < leaderboardState.totalPages) {
            leaderboardState.currentPage++;
            pageChanged = true;
        } else if (target.id === 'last-page-btn' && leaderboardState.currentPage < leaderboardState.totalPages) {
            leaderboardState.currentPage = leaderboardState.totalPages;
            pageChanged = true;
        }

        if (pageChanged) {
            updateLeaderboardView();
        }
    });

    elements.leaderboardPagination.addEventListener('change', (e) => {
        const target = e.target;
        if (target.id === 'page-input') {
            let newPage = parseInt(target.value, 10);
            if (!isNaN(newPage)) {
                newPage = Math.max(1, Math.min(newPage, leaderboardState.totalPages));
                leaderboardState.currentPage = newPage;
                updateLeaderboardView();
            }
        }
    });

    elements.closeLeaderboardBtn.addEventListener('click', () => {
        ui.hideLeaderboardView();
    });

    // Leaderboard replay buttons
    elements.leaderboardList.addEventListener('click', async (e) => {
        const watchBtn = e.target.closest('.watch-replay-btn');
        const entry = e.target.closest('.leaderboard-entry');

        if (watchBtn) {
            e.stopPropagation();
            const index = watchBtn.dataset.index;
            const scoreIndex = watchBtn.dataset.scoreIndex;
            const playerData = rankedPlayersData[index];
            
            const gameData = scoreIndex !== undefined
                ? playerData.allScores[scoreIndex]
                : playerData.bestGameData;

            if (playerData && gameData && gameData.replayDataUrl) {
                try {
                    const originalHtml = watchBtn.innerHTML;
                    watchBtn.innerHTML = '<span style="font-size: 0.6rem;">...</span>'; 
                    watchBtn.disabled = true;

                    const response = await fetch(gameData.replayDataUrl);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const replayData = await response.json();

                    if (!replayData.config.currentUser) {
                        replayData.config.currentUser = {
                            username: playerData.username,
                            avatar_url: `https://images.websim.com/avatar/${playerData.username}`
                        };
                    }

                    replayOrigin = 'leaderboard';
                    fadeOutMusic();
                    elements.leaderboardView.classList.add('hidden');
                    ui.showReplayContainer();
                    showReplay(replayData);
                    
                    watchBtn.innerHTML = originalHtml;
                    watchBtn.disabled = false;

                } catch (fetchError) {
                    console.error("Error fetching replay data:", fetchError);
                    alert("Could not load replay.");
                    watchBtn.innerHTML = '<span style="font-size: 0.6rem;">X</span>';
                    setTimeout(() => {
                        watchBtn.innerHTML = originalHtml;
                        watchBtn.disabled = false;
                    }, 2000);
                }
            }
        } else if (entry) {
            const scoreList = entry.nextElementSibling;
            if (scoreList && scoreList.classList.contains('score-list-container')) {
                scoreList.classList.toggle('hidden');
                entry.classList.toggle('expanded');
            }
        }
    });

    // Tap handler
    const tapHandler = (e) => {
        // Prevent game tap if clicking music toggle
        if (e.target.closest('#music-toggle-btn')) return;

        if (e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            game.handleTap();
        }
    };
    window.addEventListener('pointerdown', tapHandler);
    
    // Spacebar handler
    const spacebarHandler = (e) => {
        if (e.code === 'Space') {
            const focusedElement = document.activeElement;
            // If an element that expects text input is focused (e.g., the page input), don't trigger game tap.
            if (
                focusedElement && 
                (focusedElement.tagName === 'INPUT' && focusedElement.type !== 'submit' && focusedElement.type !== 'button' && focusedElement.type !== 'reset' || 
                 focusedElement.tagName === 'TEXTAREA')
            ) {
                return;
            }

            e.preventDefault();
            handleFirstInteraction();
            game.handleTap();
        }
    };
    window.addEventListener('keydown', spacebarHandler);

    // Responsive UI Scaling
    const updateUIScale = () => {
        const minDim = Math.min(window.innerWidth, window.innerHeight);
        // Base scale on a reference dimension of 450px
        // Allow it to scale down to 0.6 (small inline) and up to 1.2 (desktop)
        const scale = Math.min(Math.max(minDim / 450, 0.6), 1.2);
        document.documentElement.style.setProperty('--ui-scale', scale);
    };

    // Window resize
    window.addEventListener('resize', () => {
        game.resizeCanvas();
        updateUIScale();
    });

    // Initial setup
    updateUIScale();
    game.reset();
    ui.updateDifficulty(currentDifficulty);
    game.setDifficulty(currentDifficulty);
    migrateUserScores();
});