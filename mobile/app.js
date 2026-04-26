const DB_NAME = "lyra-breakcore-os";
const DB_VERSION = 1;
const SONGS_STORE = "songs";
const PLAYLISTS_STORE = "playlists";
const SETTINGS_KEY = "lyra-breakcore-settings";
const PLACEHOLDER_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#2b0a0a"/>
          <stop offset="1" stop-color="#09090b"/>
        </linearGradient>
      </defs>
      <rect width="600" height="600" rx="42" fill="url(#g)"/>
      <circle cx="300" cy="300" r="180" fill="none" stroke="#ef4444" stroke-width="24" opacity="0.8"/>
      <circle cx="300" cy="300" r="32" fill="#ef4444"/>
      <text x="300" y="528" fill="#fca5a5" font-size="40" text-anchor="middle" font-family="Courier New, monospace">LYRA//BREAKCORE</text>
    </svg>
  `);

const state = {
  db: null,
  songs: [],
  filteredSongs: [],
  playlists: [],
  queue: [],
  currentSongId: null,
  currentQueueIndex: -1,
  selectedPlaylistId: null,
  favoritesOnly: false,
  searchTerm: "",
  shuffle: false,
  repeatMode: "off",
  queueVisible: false,
  glitchMode: false,
  pendingCoverSongId: null,
  objectUrls: [],
  shuffledPool: [],
  settings: loadSettings(),
  audioContext: null,
  analyser: null,
  sourceNode: null,
  animationFrame: 0,
  deviceSyncInFlight: false
};

const refs = {
  bootScreen: document.getElementById("bootScreen"),
  audio: document.getElementById("audioElement"),
  screens: Array.from(document.querySelectorAll(".screen")),
  navItems: Array.from(document.querySelectorAll("[data-open-screen]")),
  libraryGrid: document.getElementById("libraryGrid"),
  playlistGrid: document.getElementById("playlistGrid"),
  queueList: document.getElementById("queueList"),
  miniQueue: document.getElementById("miniQueue"),
  queueSheet: document.getElementById("queueSheet"),
  fullscreenPlayer: document.getElementById("fullscreenPlayer"),
  toastStack: document.getElementById("toastStack"),
  songFileInput: document.getElementById("songFileInput"),
  coverFileInput: document.getElementById("coverFileInput"),
  backupFileInput: document.getElementById("backupFileInput"),
  searchInput: document.getElementById("searchInput"),
  favoriteFilterBtn: document.getElementById("favoriteFilterBtn"),
  currentCover: document.getElementById("currentCover"),
  currentTitle: document.getElementById("currentTitle"),
  currentArtist: document.getElementById("currentArtist"),
  homeCover: document.getElementById("homeCover"),
  homeTitle: document.getElementById("homeTitle"),
  homeArtist: document.getElementById("homeArtist"),
  fullscreenCover: document.getElementById("fullscreenCover"),
  fullscreenTitle: document.getElementById("fullscreenTitle"),
  fullscreenArtist: document.getElementById("fullscreenArtist"),
  currentTime: document.getElementById("currentTime"),
  totalTime: document.getElementById("totalTime"),
  progressRange: document.getElementById("progressRange"),
  volumeRange: document.getElementById("volumeRange"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  playPauseIcon: document.getElementById("playPauseIcon"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  loopBtn: document.getElementById("loopBtn"),
  queueJumpBtn: document.getElementById("queueJumpBtn"),
  themeSelect: document.getElementById("themeSelect"),
  glitchIntensity: document.getElementById("glitchIntensity"),
  glitchStateLabel: document.getElementById("glitchStateLabel"),
  visualizer: document.getElementById("visualizer"),
  playlistModal: document.getElementById("playlistModal"),
  playlistNameInput: document.getElementById("playlistNameInput"),
  libraryScopeStatus: document.getElementById("libraryScopeStatus"),
  statTracks: document.getElementById("statTracks"),
  statPlaylists: document.getElementById("statPlaylists"),
  statQueue: document.getElementById("statQueue"),
  syncDeviceBtn: document.getElementById("syncDeviceBtn"),
  miniPlayer: document.getElementById("miniPlayer"),
  miniPlayerOpenBtn: document.getElementById("miniPlayerOpenBtn"),
  miniPlayerCover: document.getElementById("miniPlayerCover"),
  miniPlayerTitle: document.getElementById("miniPlayerTitle"),
  miniPlayerArtist: document.getElementById("miniPlayerArtist"),
  miniPlayerProgress: document.getElementById("miniPlayerProgress"),
  miniPlayPauseBtn: document.getElementById("miniPlayPauseBtn"),
  miniPlayPauseIcon: document.getElementById("miniPlayPauseIcon"),
  miniPrevBtn: document.getElementById("miniPrevBtn"),
  miniNextBtn: document.getElementById("miniNextBtn")
};

init().catch(error => {
  console.error(error);
  toast("Erro", "Falha ao inicializar o Lyra mobile.");
});

async function init() {
  applySettings();
  bindEvents();
  if (!isNativeAndroid()) {
    refs.syncDeviceBtn.style.display = "none";
  }
  refs.audio.volume = state.settings.volume;
  refs.volumeRange.value = String(state.settings.volume);
  refs.themeSelect.value = state.settings.theme;
  refs.glitchIntensity.value = String(state.settings.glitchIntensity);
  state.repeatMode = state.settings.repeatMode;
  state.db = await openDb();
  await Promise.all([loadSongs(), loadPlaylists()]);
  updateQueue();
  renderAll();
  await autoSyncDeviceLibrary(false);
  hideBoot();
}

function bindEvents() {
  document.getElementById("addSongsCta").addEventListener("click", () => refs.songFileInput.click());
  document.getElementById("pickSongsBtn").addEventListener("click", () => refs.songFileInput.click());
  document.getElementById("pickCoverBtn").addEventListener("click", () => pickCoverForSong(state.currentSongId));
  refs.syncDeviceBtn.addEventListener("click", () => autoSyncDeviceLibrary(true));
  document.getElementById("openLibraryCta").addEventListener("click", () => openScreen("library"));
  document.getElementById("openNowPlaying").addEventListener("click", openFullscreen);
  document.getElementById("openFullscreenCover").addEventListener("click", openFullscreen);
  document.getElementById("closeFullscreenBtn").addEventListener("click", closeFullscreen);
  refs.miniPlayerOpenBtn.addEventListener("click", () => openScreen("player"));
  refs.miniPlayPauseBtn.addEventListener("click", event => {
    event.stopPropagation();
    togglePlayback();
  });
  refs.miniPrevBtn.addEventListener("click", event => {
    event.stopPropagation();
    previousTrack();
  });
  refs.miniNextBtn.addEventListener("click", event => {
    event.stopPropagation();
    nextTrack(false);
  });
  document.getElementById("closeQueueBtn").addEventListener("click", toggleQueueSheet);
  document.getElementById("queueJumpBtn").addEventListener("click", toggleQueueSheet);
  document.getElementById("clearQueueAction").addEventListener("click", clearQueueFilters);
  document.getElementById("createPlaylistBtn").addEventListener("click", openPlaylistModal);
  document.getElementById("closePlaylistModalBtn").addEventListener("click", closePlaylistModal);
  document.getElementById("savePlaylistBtn").addEventListener("click", savePlaylist);
  document.getElementById("toggleGlitchModeBtn").addEventListener("click", toggleGlitchMode);
  document.getElementById("pulseUiBtn").addEventListener("click", pulseUi);
  document.getElementById("exportBackupBtn").addEventListener("click", exportBackup);
  document.getElementById("importBackupBtn").addEventListener("click", () => refs.backupFileInput.click());

  refs.songFileInput.addEventListener("change", event => importSongs(event.target.files));
  refs.coverFileInput.addEventListener("change", event => handleCoverSelection(event.target.files?.[0] || null));
  refs.backupFileInput.addEventListener("change", event => importBackup(event.target.files?.[0] || null));
  refs.searchInput.addEventListener("input", event => {
    state.searchTerm = event.target.value.trim().toLowerCase();
    updateQueue();
    renderAll();
  });
  refs.favoriteFilterBtn.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    updateQueue();
    renderAll();
  });
  refs.progressRange.addEventListener("input", () => {
    if (!Number.isFinite(refs.audio.duration) || refs.audio.duration <= 0) return;
    const ratio = Number(refs.progressRange.value) / 1000;
    refs.audio.currentTime = ratio * refs.audio.duration;
    syncProgress();
  });
  refs.volumeRange.addEventListener("input", () => {
    const value = clamp(Number(refs.volumeRange.value), 0, 1);
    refs.audio.volume = value;
    state.settings.volume = value;
    persistSettings();
  });
  refs.playPauseBtn.addEventListener("click", togglePlayback);
  refs.prevBtn.addEventListener("click", previousTrack);
  refs.nextBtn.addEventListener("click", () => nextTrack(false));
  refs.shuffleBtn.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    state.shuffledPool = [];
    syncControls();
    toast("Shuffle", state.shuffle ? "Ativado." : "Desativado.");
  });
  refs.loopBtn.addEventListener("click", () => {
    state.repeatMode = state.repeatMode === "off" ? "queue" : state.repeatMode === "queue" ? "one" : "off";
    state.settings.repeatMode = state.repeatMode;
    persistSettings();
    syncControls();
    toast("Loop", repeatLabel(state.repeatMode));
  });
  refs.themeSelect.addEventListener("change", event => {
    state.settings.theme = event.target.value;
    persistSettings();
    applySettings();
  });
  refs.glitchIntensity.addEventListener("input", event => {
    state.settings.glitchIntensity = Number(event.target.value);
    persistSettings();
    applySettings();
  });
  refs.audio.addEventListener("timeupdate", syncProgress);
  refs.audio.addEventListener("loadedmetadata", syncProgress);
  refs.audio.addEventListener("play", () => {
    syncControls();
    setupVisualizer();
    updateMediaSession();
  });
  refs.audio.addEventListener("pause", () => {
    syncControls();
    updateMediaSession();
  });
  refs.audio.addEventListener("ended", handleTrackEnd);
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-open-screen]");
    if (button) openScreen(button.dataset.openScreen);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncProgress();
  });
  window.addEventListener("beforeunload", () => {
    revokeSongUrls();
    cancelAnimationFrame(state.animationFrame);
  });
}

function hideBoot() {
  window.setTimeout(() => {
    refs.bootScreen.classList.add("hidden");
    document.body.classList.remove("booting");
  }, 1200);
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      theme: parsed.theme || "breakcore",
      glitchIntensity: Number.isFinite(parsed.glitchIntensity) ? parsed.glitchIntensity : 68,
      volume: Number.isFinite(parsed.volume) ? parsed.volume : 0.9,
      repeatMode: ["off", "queue", "one"].includes(parsed.repeatMode) ? parsed.repeatMode : "off"
    };
  } catch {
    return { theme: "breakcore", glitchIntensity: 68, volume: 0.9, repeatMode: "off" };
  }
}

function isNativeAndroid() {
  return Boolean(window.Capacitor?.getPlatform?.() === "android");
}

function getMediaScannerPlugin() {
  return window.Capacitor?.Plugins?.LyraMediaScanner || null;
}

function getSyncErrorMessage(error) {
  const raw = typeof error === "string"
    ? error
    : error?.message || error?.errorMessage || error?.detail || "";
  const message = String(raw || "").trim();
  if (!message) {
    return "Não foi possível sincronizar os MP3s do aparelho.";
  }
  if (/permission|denied|not granted|unauthorized/i.test(message)) {
    return "Permita o acesso aos arquivos de áudio para importar os MP3s do celular.";
  }
  if (/plugin|scanner/i.test(message)) {
    return "Este APK não carregou o leitor nativo de MP3s corretamente.";
  }
  return message;
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function applySettings() {
  document.body.dataset.theme = state.settings.theme;
  document.documentElement.style.setProperty("--glitch-intensity", String(state.settings.glitchIntensity / 100));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        db.createObjectStore(SONGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
        db.createObjectStore(PLAYLISTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadSongs() {
  revokeSongUrls();
  const rows = await dbGetAll(SONGS_STORE);
  state.songs = rows
    .sort((a, b) => Number(a.addedAt || 0) - Number(b.addedAt || 0))
    .map(song => ({
      ...song,
      audioUrl: resolveSongAudioUrl(song),
      coverUrl: resolveSongCoverUrl(song)
    }));
  state.objectUrls.push(
    ...state.songs.flatMap(song =>
      [song.audioUrl, song.coverUrl].filter(url => url && url.startsWith("blob:"))
    )
  );
}

function resolveSongAudioUrl(song) {
  if (song.audioBlob) {
    return URL.createObjectURL(song.audioBlob);
  }
  if (song.filePath) {
    return nativeFileUrl(song.filePath);
  }
  return "";
}

function resolveSongCoverUrl(song) {
  if (song.coverBlob) {
    return URL.createObjectURL(song.coverBlob);
  }
  if (song.coverPath) {
    return nativeFileUrl(song.coverPath);
  }
  return PLACEHOLDER_COVER;
}

function nativeFileUrl(filePath) {
  if (!filePath) return "";
  if (window.Capacitor?.convertFileSrc) {
    return window.Capacitor.convertFileSrc(`file://${filePath}`);
  }
  return `file://${filePath}`;
}

async function loadPlaylists() {
  const rows = await dbGetAll(PLAYLISTS_STORE);
  state.playlists = rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
}

function revokeSongUrls() {
  state.objectUrls.forEach(url => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // noop
    }
  });
  state.objectUrls = [];
}

function openScreen(screenId) {
  refs.screens.forEach(screen => screen.classList.toggle("active", screen.dataset.screen === screenId));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.openScreen === screenId));
}

function syncFilteredSongs() {
  state.filteredSongs = state.songs.filter(song => {
    const text = `${song.title} ${song.artist}`.toLowerCase();
    const matchesSearch = text.includes(state.searchTerm);
    const matchesPlaylist = state.selectedPlaylistId ? (song.playlists || []).includes(state.selectedPlaylistId) : true;
    const matchesFav = state.favoritesOnly ? Boolean(song.isFavorite) : true;
    return matchesSearch && matchesPlaylist && matchesFav;
  });
}

function updateQueue(resetQueue = false) {
  syncFilteredSongs();
  const songMap = new Map(state.songs.map(song => [song.id, song]));
  const normalizedQueue = state.queue
    .map(song => songMap.get(song.id))
    .filter(Boolean);

  if (resetQueue) {
    state.queue = state.filteredSongs.slice();
  } else if (!normalizedQueue.length) {
    state.queue = (state.filteredSongs.length ? state.filteredSongs : state.songs).slice();
  } else {
    const knownIds = new Set(normalizedQueue.map(song => song.id));
    const appendedSongs = state.songs.filter(song => !knownIds.has(song.id));
    state.queue = [...normalizedQueue, ...appendedSongs];
  }

  if (state.currentSongId && !state.queue.some(song => song.id === state.currentSongId)) {
    state.currentSongId = null;
    state.currentQueueIndex = -1;
    refs.audio.pause();
    refs.audio.removeAttribute("src");
  }
  syncCurrentQueueIndex();
}

function syncCurrentQueueIndex() {
  if (!state.currentSongId) {
    state.currentQueueIndex = -1;
    return;
  }
  state.currentQueueIndex = state.queue.findIndex(song => song.id === state.currentSongId);
}

function renderAll() {
  renderLibrary();
  renderPlaylists();
  renderQueue();
  renderHome();
  syncControls();
  syncPlayerMeta();
  syncStats();
}

function renderLibrary() {
  if (!state.filteredSongs.length) {
    refs.libraryGrid.innerHTML = `
      <article class="empty-state">
        <strong>Nenhuma faixa visível.</strong>
        <p>Importe músicas, troque a busca ou mude o filtro para povoar o sistema.</p>
      </article>
    `;
    syncLibraryScope();
    return;
  }

  refs.libraryGrid.innerHTML = state.filteredSongs
    .map(song => {
      const playing = song.id === state.currentSongId;
      const inPlaylist = (song.playlists || []).length;
      return `
        <article class="track-card ${playing ? "playing" : ""}">
          <img class="track-cover" src="${song.coverUrl}" alt="Capa de ${escapeHtml(song.title)}">
          <div class="track-meta">
            <strong>${escapeHtml(song.title)}</strong>
            <span>${escapeHtml(song.artist)}</span>
            <div class="track-actions">
              <button class="track-pill" data-action="play-song" data-song-id="${song.id}">${playing ? "Tocando" : "Play"}</button>
              <button class="track-pill ${song.isFavorite ? "active" : ""}" data-action="favorite-song" data-song-id="${song.id}">Fav</button>
              <button class="track-pill" data-action="cover-song" data-song-id="${song.id}">Capa</button>
              <button class="track-pill" data-action="playlist-song" data-song-id="${song.id}">Playlist${inPlaylist ? ` (${inPlaylist})` : ""}</button>
              <button class="track-pill" data-action="delete-song" data-song-id="${song.id}">Excluir</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  refs.libraryGrid.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", handleLibraryAction);
  });
  syncLibraryScope();
}

function renderPlaylists() {
  const cards = [
    `
      <article class="playlist-card ${state.selectedPlaylistId ? "" : "active"}">
        <img class="playlist-cover" src="${PLACEHOLDER_COVER}" alt="Biblioteca completa">
        <div class="playlist-meta">
          <strong>Todas as faixas</strong>
          <small>${state.songs.length} itens</small>
          <div class="playlist-actions">
            <button class="track-pill ${state.selectedPlaylistId ? "" : "active"}" data-action="select-playlist" data-playlist-id="">Abrir</button>
          </div>
        </div>
      </article>
    `
  ];

  cards.push(
    ...state.playlists.map(playlist => {
      const count = state.songs.filter(song => (song.playlists || []).includes(playlist.id)).length;
      const active = playlist.id === state.selectedPlaylistId;
      return `
        <article class="playlist-card ${active ? "active" : ""}">
          <img class="playlist-cover" src="${playlist.coverUrl || PLACEHOLDER_COVER}" alt="Capa da playlist ${escapeHtml(playlist.name)}">
          <div class="playlist-meta">
            <strong>${escapeHtml(playlist.name)}</strong>
            <small>${count} faixa(s)</small>
            <div class="playlist-actions">
              <button class="track-pill ${active ? "active" : ""}" data-action="select-playlist" data-playlist-id="${playlist.id}">Abrir</button>
              <button class="track-pill" data-action="queue-playlist" data-playlist-id="${playlist.id}">Tocar</button>
              <button class="track-pill" data-action="delete-playlist" data-playlist-id="${playlist.id}">Excluir</button>
            </div>
          </div>
        </article>
      `;
    })
  );

  refs.playlistGrid.innerHTML = cards.join("") || `
    <article class="empty-state">
      <strong>Nenhuma playlist criada.</strong>
      <p>Monte suas rotas de reprodução aqui.</p>
    </article>
  `;

  refs.playlistGrid.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", handlePlaylistAction);
  });
}

function renderQueue() {
  const queueItems = state.queue.length
    ? state.queue.map((song, index) => `
        <button class="queue-item ${song.id === state.currentSongId ? "active" : ""}" data-queue-index="${index}">
          <img src="${song.coverUrl}" alt="Capa de ${escapeHtml(song.title)}">
          <div class="track-meta">
            <strong>${escapeHtml(song.title)}</strong>
            <span>${escapeHtml(song.artist)}</span>
          </div>
          <span>${index + 1}</span>
        </button>
      `).join("")
    : `<div class="empty-state"><strong>Fila vazia.</strong><p>As faixas filtradas aparecem aqui.</p></div>`;

  refs.queueList.innerHTML = queueItems;
  refs.miniQueue.innerHTML = state.queue.slice(0, 4).map((song, index) => `
    <button class="queue-item ${song.id === state.currentSongId ? "active" : ""}" data-queue-index="${index}">
      <img src="${song.coverUrl}" alt="Capa de ${escapeHtml(song.title)}">
      <div class="track-meta">
        <strong>${escapeHtml(song.title)}</strong>
        <span>${escapeHtml(song.artist)}</span>
      </div>
      <span>${index + 1}</span>
    </button>
  `).join("");

  [refs.queueList, refs.miniQueue].forEach(scope => {
    scope.querySelectorAll("[data-queue-index]").forEach(button => {
      button.addEventListener("click", () => playFromQueue(Number(button.dataset.queueIndex), false));
    });
  });
}

function renderHome() {
  const currentSong = getCurrentSong();
  refs.homeCover.src = currentSong?.coverUrl || PLACEHOLDER_COVER;
  refs.homeTitle.textContent = currentSong?.title || "Sistema ocioso";
  refs.homeArtist.textContent = currentSong?.artist || "Nenhuma faixa em reprodução";
}

function syncStats() {
  refs.statTracks.textContent = String(state.songs.length);
  refs.statPlaylists.textContent = String(state.playlists.length);
  refs.statQueue.textContent = String(state.queue.length);
}

function syncPlayerMeta() {
  const currentSong = getCurrentSong();
  refs.currentCover.src = currentSong?.coverUrl || PLACEHOLDER_COVER;
  refs.currentTitle.textContent = currentSong?.title || "Pronto para ouvir";
  refs.currentArtist.textContent = currentSong?.artist || "Adicione músicas do dispositivo para começar.";
  refs.fullscreenCover.src = currentSong?.coverUrl || PLACEHOLDER_COVER;
  refs.fullscreenTitle.textContent = currentSong?.title || "Lyra";
  refs.fullscreenArtist.textContent = currentSong?.artist || "Breakcore OS";
  refs.miniPlayerCover.src = currentSong?.coverUrl || PLACEHOLDER_COVER;
  refs.miniPlayerTitle.textContent = currentSong?.title || "Lyra Breakcore OS";
  refs.miniPlayerArtist.textContent = currentSong?.artist || "Aguardando faixa";
  refs.miniPlayer.hidden = !currentSong && !state.queue.length;
}

function syncControls() {
  refs.shuffleBtn.classList.toggle("active", state.shuffle);
  refs.loopBtn.classList.toggle("active", state.repeatMode !== "off");
  refs.loopBtn.title = repeatLabel(state.repeatMode);
  refs.loopBtn.setAttribute("data-loop-mode", state.repeatMode);
  refs.favoriteFilterBtn.classList.toggle("active", state.favoritesOnly);
  const playing = !refs.audio.paused && Boolean(refs.audio.src);
  refs.playPauseIcon.className = `icon ${playing ? "icon-pause" : "icon-play"}`;
  refs.miniPlayPauseIcon.className = `icon ${playing ? "icon-pause" : "icon-play"}`;
  refs.playPauseBtn.setAttribute("aria-label", playing ? "Pausar" : "Tocar");
  refs.miniPlayPauseBtn.setAttribute("aria-label", playing ? "Pausar" : "Tocar");
  refs.glitchStateLabel.textContent = state.glitchMode ? "Sobrecarga ativa" : "Glitch controlado";
}

function syncProgress() {
  const current = Number.isFinite(refs.audio.currentTime) ? refs.audio.currentTime : 0;
  const duration = Number.isFinite(refs.audio.duration) ? refs.audio.duration : 0;
  const ratio = duration > 0 ? current / duration : 0;
  refs.currentTime.textContent = formatTime(current);
  refs.totalTime.textContent = formatTime(duration);
  refs.progressRange.value = duration > 0 ? String(Math.round(ratio * 1000)) : "0";
  refs.miniPlayerProgress.textContent = duration > 0
    ? `${formatTime(current)} / ${formatTime(duration)}`
    : "0:00 / 0:00";
  refs.miniPlayerProgress.style.background = `linear-gradient(90deg, rgba(239, 68, 68, 0.52) 0%, rgba(239, 68, 68, 0.52) ${Math.round(ratio * 100)}%, rgba(239, 68, 68, 0.08) ${Math.round(ratio * 100)}%, rgba(239, 68, 68, 0.08) 100%)`;
}

function handleLibraryAction(event) {
  const action = event.currentTarget.dataset.action;
  const songId = event.currentTarget.dataset.songId;
  if (!songId) return;
  const id = Number(songId);

  if (action === "play-song") {
    const index = ensureSongQueued(id);
    if (index >= 0) playFromQueue(index);
  } else if (action === "favorite-song") {
    toggleFavorite(id);
  } else if (action === "cover-song") {
    pickCoverForSong(id);
  } else if (action === "playlist-song") {
    promptPlaylistAssignment(id);
  } else if (action === "delete-song") {
    deleteSong(id);
  }
}

function handlePlaylistAction(event) {
  const action = event.currentTarget.dataset.action;
  const playlistId = event.currentTarget.dataset.playlistId;
  if (action === "select-playlist") {
    state.selectedPlaylistId = playlistId ? Number(playlistId) : null;
    updateQueue();
    renderAll();
    openScreen("library");
    return;
  }
  if (!playlistId) return;
  const id = Number(playlistId);
  if (action === "queue-playlist") {
    state.selectedPlaylistId = id;
    updateQueue(true);
    renderAll();
    if (state.queue.length) playFromQueue(0);
    openScreen("player");
  } else if (action === "delete-playlist") {
    deletePlaylist(id);
  }
}

async function importSongs(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  for (const file of files) {
    const meta = inferSongMeta(file.name);
    const song = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      source: "manual",
      title: meta.title,
      artist: meta.artist,
      audioBlob: file,
      coverBlob: null,
      playlists: [],
      isFavorite: false,
      addedAt: Date.now()
    };
    await dbPut(SONGS_STORE, song);
  }

  refs.songFileInput.value = "";
  await loadSongs();
  updateQueue();
  renderAll();
  toast("Biblioteca", `${files.length} faixa(s) adicionada(s).`);
  if (!state.currentSongId && state.queue.length) {
    playFromQueue(0, false);
  }
}

async function autoSyncDeviceLibrary(showToast = false) {
  if (!isNativeAndroid()) return;
  const plugin = getMediaScannerPlugin();
  if (state.deviceSyncInFlight) return;
  if (!plugin?.syncDeviceLibrary) {
    if (showToast) {
      toast("Android", "Este APK não tem o leitor nativo de MP3s ativo.");
    }
    return;
  }

  state.deviceSyncInFlight = true;
  refs.syncDeviceBtn.disabled = true;
  const originalLabel = refs.syncDeviceBtn.textContent;
  refs.syncDeviceBtn.textContent = "Lendo MP3s...";

  try {
    const result = await plugin.syncDeviceLibrary();
    const songs = Array.isArray(result?.songs) ? result.songs : [];
    const syncedIds = new Set((Array.isArray(result?.syncedIds) ? result.syncedIds : []).map(String));
    const existingById = new Map(state.songs.map(song => [String(song.id), song]));

    for (const song of songs) {
      const previous = existingById.get(String(song.id));
      await dbPut(SONGS_STORE, {
        ...song,
        source: "device",
        audioBlob: null,
        coverBlob: null,
        playlists: previous?.playlists || [],
        isFavorite: previous?.isFavorite || false
      });
    }

    const staleDeviceSongs = state.songs.filter(song => song.source === "device" && !syncedIds.has(String(song.id)));
    for (const staleSong of staleDeviceSongs) {
      await dbDelete(SONGS_STORE, staleSong.id);
    }

    await loadSongs();
    updateQueue();
    renderAll();
    if (showToast || songs.length) {
      toast("Android", `${songs.length} MP3(s) reconhecido(s) do celular.`);
    }
  } catch (error) {
    const message = getSyncErrorMessage(error);
    console.error("Device sync failed:", message, error);
    if (showToast) {
      toast("Android", message);
    }
  } finally {
    state.deviceSyncInFlight = false;
    refs.syncDeviceBtn.disabled = false;
    refs.syncDeviceBtn.textContent = originalLabel;
  }
}

async function savePlaylist() {
  const name = refs.playlistNameInput.value.trim();
  if (!name) return;
  const playlist = {
    id: Date.now(),
    name,
    coverUrl: "",
    createdAt: Date.now()
  };
  await dbPut(PLAYLISTS_STORE, playlist);
  refs.playlistNameInput.value = "";
  closePlaylistModal();
  await loadPlaylists();
  renderAll();
  toast("Playlists", `Playlist "${name}" criada.`);
}

function openPlaylistModal() {
  refs.playlistModal.classList.add("active");
  refs.playlistModal.setAttribute("aria-hidden", "false");
  refs.playlistNameInput.focus();
}

function closePlaylistModal() {
  refs.playlistModal.classList.remove("active");
  refs.playlistModal.setAttribute("aria-hidden", "true");
}

async function toggleFavorite(songId) {
  const song = state.songs.find(item => item.id === songId);
  if (!song) return;
  await dbPut(SONGS_STORE, {
    ...stripRuntimeSongFields(song),
    isFavorite: !song.isFavorite
  });
  await loadSongs();
  updateQueue();
  renderAll();
}

function pickCoverForSong(songId) {
  if (!songId) {
    toast("Capa", "Escolha uma faixa ou toque uma música antes.");
    return;
  }
  state.pendingCoverSongId = songId;
  refs.coverFileInput.click();
}

async function handleCoverSelection(file) {
  if (!file || !state.pendingCoverSongId) return;
  const song = state.songs.find(item => item.id === state.pendingCoverSongId);
  if (!song) return;
  await dbPut(SONGS_STORE, {
    ...stripRuntimeSongFields(song),
    coverBlob: file
  });
  state.pendingCoverSongId = null;
  refs.coverFileInput.value = "";
  await loadSongs();
  updateQueue();
  renderAll();
  updateMediaSession();
  toast("Capa", "Imagem da faixa atualizada.");
}

async function promptPlaylistAssignment(songId) {
  if (!state.playlists.length) {
    toast("Playlist", "Crie uma playlist antes de adicionar faixas.");
    openScreen("playlists");
    return;
  }

  const song = state.songs.find(item => item.id === songId);
  if (!song) return;

  const options = state.playlists.map((playlist, index) => `${index + 1}. ${playlist.name}`).join("\n");
  const answer = window.prompt(`Escolha a playlist:\n${options}`);
  if (!answer) return;
  const choice = Number(answer.trim());
  const picked = state.playlists[choice - 1];
  if (!picked) {
    toast("Playlist", "Seleção inválida.");
    return;
  }
  const merged = Array.from(new Set([...(song.playlists || []), picked.id]));
  await dbPut(SONGS_STORE, {
    ...stripRuntimeSongFields(song),
    playlists: merged
  });
  await loadSongs();
  updateQueue();
  renderAll();
  toast("Playlist", `Faixa enviada para "${picked.name}".`);
}

async function deleteSong(songId) {
  const confirmed = window.confirm("Excluir esta faixa da biblioteca offline?");
  if (!confirmed) return;
  const song = state.songs.find(item => item.id === songId);
  if (song?.source === "device") {
    toast("Biblioteca", "Faixas do celular voltam na próxima sincronização se ainda existirem no aparelho.");
  }
  const currentWasDeleted = state.currentSongId === songId;
  await dbDelete(SONGS_STORE, songId);
  if (currentWasDeleted) {
    refs.audio.pause();
    refs.audio.removeAttribute("src");
    state.currentSongId = null;
    state.currentQueueIndex = -1;
  }
  await loadSongs();
  updateQueue();
  renderAll();
  toast("Biblioteca", "Faixa removida.");
}

async function deletePlaylist(playlistId) {
  const confirmed = window.confirm("Excluir esta playlist?");
  if (!confirmed) return;

  for (const song of state.songs) {
    if ((song.playlists || []).includes(playlistId)) {
      await dbPut(SONGS_STORE, {
        ...stripRuntimeSongFields(song),
        playlists: (song.playlists || []).filter(id => id !== playlistId)
      });
    }
  }

  await dbDelete(PLAYLISTS_STORE, playlistId);
  if (state.selectedPlaylistId === playlistId) {
    state.selectedPlaylistId = null;
  }
  await Promise.all([loadSongs(), loadPlaylists()]);
  updateQueue();
  renderAll();
  toast("Playlists", "Playlist excluída.");
}

function clearQueueFilters() {
  state.searchTerm = "";
  state.favoritesOnly = false;
  state.selectedPlaylistId = null;
  refs.searchInput.value = "";
  updateQueue();
  renderAll();
}

function toggleQueueSheet() {
  state.queueVisible = !state.queueVisible;
  refs.queueSheet.classList.toggle("active", state.queueVisible);
  refs.queueSheet.setAttribute("aria-hidden", state.queueVisible ? "false" : "true");
}

function openFullscreen() {
  refs.fullscreenPlayer.classList.add("active");
  refs.fullscreenPlayer.setAttribute("aria-hidden", "false");
}

function closeFullscreen() {
  refs.fullscreenPlayer.classList.remove("active");
  refs.fullscreenPlayer.setAttribute("aria-hidden", "true");
}

async function playFromQueue(index, switchScreen = true) {
  if (index < 0 || index >= state.queue.length) return;
  const song = state.queue[index];
  state.currentSongId = song.id;
  state.currentQueueIndex = index;
  refs.audio.src = song.audioUrl;
  ensureAudioGraph();
  try {
    await refs.audio.play();
  } catch (error) {
    console.error(error);
    toast("Player", "Não foi possível iniciar essa faixa.");
    return;
  }
  state.shuffledPool = [];
  syncPlayerMeta();
  syncControls();
  syncProgress();
  renderLibrary();
  renderQueue();
  renderHome();
  updateMediaSession();
  refs.miniPlayer.hidden = false;
  if (switchScreen) openScreen("player");
}

async function togglePlayback() {
  if (!refs.audio.src) {
    if (state.queue.length) {
      await playFromQueue(Math.max(state.currentQueueIndex, 0));
    }
    return;
  }

  if (refs.audio.paused) {
    try {
      await refs.audio.play();
    } catch (error) {
      console.error(error);
      toast("Player", "Toque na faixa novamente para liberar o áudio.");
    }
  } else {
    refs.audio.pause();
  }
}

function getCurrentSong() {
  return state.songs.find(song => song.id === state.currentSongId) || null;
}

function previousTrack() {
  if (!state.queue.length) return;
  if (refs.audio.currentTime > 3) {
    refs.audio.currentTime = 0;
    return;
  }
  const nextIndex = state.currentQueueIndex <= 0 ? state.queue.length - 1 : state.currentQueueIndex - 1;
  void playFromQueue(nextIndex, false);
}

function nextTrack(fromEnded) {
  if (!state.queue.length) return;
  if (state.shuffle) {
    void playFromQueue(nextShuffleIndex(), false);
    return;
  }
  const atLast = state.currentQueueIndex >= state.queue.length - 1;
  if (atLast && fromEnded && state.repeatMode === "off") {
    refs.audio.pause();
    refs.audio.currentTime = 0;
    syncProgress();
    syncControls();
    return;
  }
  const nextIndex = atLast ? 0 : state.currentQueueIndex + 1;
  void playFromQueue(nextIndex, false);
}

function handleTrackEnd() {
  if (state.repeatMode === "one") {
    refs.audio.currentTime = 0;
    refs.audio.play();
    return;
  }
  nextTrack(true);
}

function nextShuffleIndex() {
  if (state.queue.length === 1) return 0;
  if (state.shuffledPool.length !== state.queue.length) {
    state.shuffledPool = state.queue.map((_, index) => index).sort(() => Math.random() - 0.5);
  }
  let nextIndex = state.shuffledPool.pop();
  while (nextIndex === state.currentQueueIndex && state.shuffledPool.length) {
    nextIndex = state.shuffledPool.pop();
  }
  return typeof nextIndex === "number" ? nextIndex : 0;
}

function ensureAudioGraph() {
  if (state.audioContext) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  state.audioContext = new AudioCtx();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 128;
  state.sourceNode = state.audioContext.createMediaElementSource(refs.audio);
  state.sourceNode.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);
}

function setupVisualizer() {
  ensureAudioGraph();
  if (!state.analyser) return;
  if (state.audioContext?.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
  const canvas = refs.visualizer;
  const context = canvas.getContext("2d");
  const dataArray = new Uint8Array(state.analyser.frequencyBinCount);

  const draw = () => {
    state.animationFrame = requestAnimationFrame(draw);
    state.analyser.getByteFrequencyData(dataArray);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = canvas.width / dataArray.length;
    dataArray.forEach((value, index) => {
      const barHeight = (value / 255) * canvas.height;
      const x = index * barWidth;
      const y = canvas.height - barHeight;
      context.fillStyle = `rgba(239, 68, 68, ${0.35 + value / 255})`;
      context.fillRect(x + 1, y, Math.max(3, barWidth - 2), barHeight);
    });
  };

  cancelAnimationFrame(state.animationFrame);
  draw();
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const song = getCurrentSong();
  if (!song) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: "Lyra Breakcore OS",
    artwork: [{ src: song.coverUrl, sizes: "512x512", type: "image/png" }]
  });
  navigator.mediaSession.playbackState = refs.audio.paused ? "paused" : "playing";
  navigator.mediaSession.setActionHandler("play", () => refs.audio.play());
  navigator.mediaSession.setActionHandler("pause", () => refs.audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
  navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(false));
  navigator.mediaSession.setActionHandler("seekto", details => {
    if (typeof details.seekTime === "number") {
      refs.audio.currentTime = details.seekTime;
      syncProgress();
    }
  });
}

function syncLibraryScope() {
  const scopes = [];
  if (state.selectedPlaylistId) {
    const playlist = state.playlists.find(item => item.id === state.selectedPlaylistId);
    if (playlist) scopes.push(`Playlist: ${playlist.name}`);
  }
  if (state.favoritesOnly) scopes.push("Favoritos");
  if (state.searchTerm) scopes.push(`Busca: "${state.searchTerm}"`);
  refs.libraryScopeStatus.textContent = scopes.length
    ? `Filtros ativos: ${scopes.join(" • ")}.`
    : "Exibindo toda a biblioteca.";
}

function ensureSongQueued(songId) {
  const existingIndex = state.queue.findIndex(song => song.id === songId);
  if (existingIndex >= 0) return existingIndex;
  const song = state.songs.find(item => item.id === songId);
  if (!song) return -1;
  state.queue = [song, ...state.queue.filter(item => item.id !== songId)];
  syncCurrentQueueIndex();
  renderQueue();
  syncStats();
  return 0;
}

async function exportBackup() {
  const exportableSongs = state.songs.filter(song => song.source !== "device" && song.audioBlob);
  const payload = {
    exportedAt: new Date().toISOString(),
    songs: await Promise.all(exportableSongs.map(async song => ({
      ...stripRuntimeSongFields(song),
      audioDataUrl: await blobToDataUrl(song.audioBlob),
      coverDataUrl: song.coverBlob ? await blobToDataUrl(song.coverBlob) : ""
    }))),
    playlists: state.playlists
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "lyra-breakcore-backup.json";
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Backup", "Exportação concluída.");
}

async function importBackup(file) {
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.songs) || !Array.isArray(payload.playlists)) {
    toast("Backup", "Arquivo inválido.");
    return;
  }

  for (const song of payload.songs) {
    await dbPut(SONGS_STORE, {
      ...song,
      source: song.source || "manual",
      audioBlob: dataUrlToBlob(song.audioDataUrl),
      coverBlob: song.coverDataUrl ? dataUrlToBlob(song.coverDataUrl) : null
    });
  }
  for (const playlist of payload.playlists) {
    await dbPut(PLAYLISTS_STORE, playlist);
  }
  refs.backupFileInput.value = "";
  await Promise.all([loadSongs(), loadPlaylists()]);
  updateQueue();
  renderAll();
  toast("Backup", "Biblioteca restaurada.");
}

function toggleGlitchMode() {
  state.glitchMode = !state.glitchMode;
  document.body.classList.toggle("glitch-mode", state.glitchMode);
  syncControls();
}

function pulseUi() {
  document.body.classList.add("glitch-mode");
  window.setTimeout(() => {
    if (!state.glitchMode) document.body.classList.remove("glitch-mode");
  }, 900);
}

function inferSongMeta(fileName) {
  const cleaned = String(fileName).replace(/\.[^/.]+$/, "");
  const parts = cleaned.split(" - ");
  if (parts.length >= 2) {
    return { artist: parts[0].trim() || "Desconhecido", title: parts.slice(1).join(" - ").trim() || cleaned };
  }
  return { artist: "Arquivo local", title: cleaned || "Sem título" };
}

function stripRuntimeSongFields(song) {
  const { audioUrl, coverUrl, ...persisted } = song;
  return persisted;
}

function repeatLabel(mode) {
  if (mode === "queue") return "Repetindo a fila.";
  if (mode === "one") return "Repetindo a música atual.";
  return "Loop desativado.";
}

function toast(title, message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  refs.toastStack.appendChild(node);
  window.setTimeout(() => node.remove(), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, encoded] = String(dataUrl).split(",");
  const mime = /data:(.*?);base64/.exec(meta || "")?.[1] || "application/octet-stream";
  const binary = atob(encoded || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}
