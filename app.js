// ============================================================
//  FLUX — app.js
//  v2.0.0
//  Architecture : 8 modules
//  1. CONFIG       2. STATE        3. LAYOUT
//  4. FEEDS        5. PODCASTS     6. SEARCH
//  7. RENDER       8. INIT
// ============================================================

'use strict';

// ══════════════════════════════════════════════
//  1. CONFIG — Constantes et configuration
// ══════════════════════════════════════════════

const APP_VERSION = '2.0.0';

// Proxies CORS (essayés dans l'ordre en cas d'échec direct)
const CORS_PROXIES = [
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// Vues dans le swipe track (dans l'ordre)
const SWIPE_VIEWS = ['flux', 'search', 'podcast', 'feeds'];

// Vitesses de lecture podcast
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

// Limites localStorage
const MAX_ARTICLES  = 1000;
const MAX_EPISODES  = 300;
const STORAGE_WARN_KB = 4000;

// Suggestions de flux RSS par défaut
const DEFAULT_FEEDS = [
  { name: 'Le Grand Continent',        url: 'https://legrandcontinent.eu/fr/feed/',                  color: '#1a3a6b' },
  { name: 'Alternatives Économiques',  url: 'https://www.alternatives-economiques.fr/rss.xml',        color: '#c03a2b' },
  { name: 'Mediapart',                 url: 'https://www.mediapart.fr/articles/feed',                 color: '#c0392b' },
  { name: 'The Conversation',          url: 'https://theconversation.com/fr/articles.atom',           color: '#2e86ab' },
  { name: 'Monde Diplomatique',        url: 'https://www.monde-diplomatique.fr/rss/',                 color: '#3d2a00' },
];

// Chemins RSS à essayer lors de la découverte d'un site
const RSS_PATHS = [
  '/feed', '/feed/', '/feed.xml', '/feed.rss', '/feed.atom',
  '/rss', '/rss/', '/rss.xml', '/rss2.xml',
  '/atom', '/atom.xml', '/atom/',
  '/index.xml', '/blog/feed', '/news/feed',
  '/?feed=rss2', '/?feed=rss', '/?feed=atom',
];


// Palette couleurs flux
const FEED_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6',
  '#8b5cf6','#ef4444','#14b8a6','#f97316','#84cc16',
  '#06b6d4','#a855f7','#e11d48','#0ea5e9','#22c55e',
];

// Flux de découverte (explorateur)
const DISCOVERY_FEEDS = [
  { name: 'Le Monde',           url: 'https://www.lemonde.fr/rss/une.xml',                     icon: '🌍' },
  { name: 'Le Figaro',          url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml',       icon: '📰' },
  { name: 'France Inter',       url: 'https://www.franceinter.fr/rss',                          icon: '📻' },
  { name: 'Le Grand Continent', url: 'https://legrandcontinent.eu/fr/feed/',                    icon: '🌐' },
  { name: 'The Conversation',   url: 'https://theconversation.com/fr/articles.atom',            icon: '🎓' },
  { name: 'Numerama',           url: 'https://www.numerama.com/feed/',                          icon: '💻' },
];


// ══════════════════════════════════════════════
//  2. STATE — État global et persistance
// ══════════════════════════════════════════════

/**
 * État global de l'application.
 * Toute mutation doit passer par les fonctions de ce module.
 */
const state = {
  // Données
  feeds:       [],
  articles:    [],
  podcasts:    [],
  episodes:    [],
  readIds:     new Set(),
  savedIds:    new Set(),
  feedHealth:  {},

  // Navigation
  currentView:  'flux',
  activeFilter: 'all',
  mainTab:      'fluxlist',

  // Recherche
  searchMode: 'flux',
  searchQuery: '',
  searchSelectedFeeds: null,
  search: { inTitle: true, inBody: true, period: 'all' },

  // Player podcast
  currentEpisode: null,
  playerPosition: 0,

  // Réglages
  settings: {
    markRead:   true,
    showImages: true,
  },
};

// Données sauvegardées académique (séparées de state pour les performances)
let savedAcademicArticles = [];

// Variables globales de navigation (utilisées hors module)
let searchMode = 'flux';
let podTab     = 'list';
let srcTab     = 'flux';
let rssSearchTimer  = null;
let podSearchTimer  = null;
let discoveryArticles  = [];
let discoveryBySource  = {};

/** Calcule l'espace localStorage utilisé en KB */
function getStorageUsedKB() {
  let total = 0;
  for (const key in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
      total += localStorage[key].length * 2;
    }
  }
  return Math.round(total / 1024);
}

/** Réduit les données pour libérer de l'espace */
function trimToFit() {
  if (state.articles.length > 500) {
    const saved = new Set([...state.savedIds]);
    const savedArts = state.articles.filter(a => saved.has(a.id));
    const rest = state.articles
      .filter(a => !saved.has(a.id))
      .slice(0, 500 - savedArts.length);
    state.articles = [...savedArts, ...rest]
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  if (state.episodes.length > 150) {
    state.episodes = state.episodes.slice(0, 150);
  }
  state.articles = state.articles.map(a => ({
    ...a,
    description: (a.description || '').slice(0, 400),
  }));
}

/** Sauvegarde l'état dans localStorage */
function save() {
  const usedKB = getStorageUsedKB();
  if (usedKB > STORAGE_WARN_KB) {
    trimToFit();
    showToast('⚠ Stockage limité — anciens articles supprimés');
  }

  const epsToSave = state.episodes
    .slice(0, MAX_EPISODES)
    .map(ep => ({ ...ep, description: (ep.description || '').slice(0, 150) }));

  const artsToSave = state.articles
    .slice(0, MAX_ARTICLES)
    .map(a => ({ ...a, description: (a.description || '').slice(0, 400) }));

  try {
    localStorage.setItem('rss_feeds',       JSON.stringify(state.feeds));
    localStorage.setItem('rss_articles',    JSON.stringify(artsToSave));
    localStorage.setItem('rss_read',        JSON.stringify([...state.readIds].slice(-2000)));
    localStorage.setItem('rss_podcasts',    JSON.stringify(state.podcasts));
    localStorage.setItem('rss_saved',       JSON.stringify([...state.savedIds]));
    localStorage.setItem('rss_episodes',    JSON.stringify(epsToSave));
    localStorage.setItem('rss_settings',    JSON.stringify(state.settings));
    localStorage.setItem('rss_feed_health', JSON.stringify(state.feedHealth));
    localStorage.setItem('rss_ac_saved',    JSON.stringify(savedAcademicArticles));
  } catch (err) {
    // Quota dépassé : sauvegarder le minimum vital
    console.error('[save] Quota dépassé:', err);
    try {
      localStorage.setItem('rss_feeds',    JSON.stringify(state.feeds));
      localStorage.setItem('rss_podcasts', JSON.stringify(state.podcasts));
      localStorage.setItem('rss_settings', JSON.stringify(state.settings));
    } catch (e) {
      console.error('[save] Échec sauvegarde minimale:', e);
    }
    showToast('⚠ Stockage saturé — sauvegarde partielle');
  }
}

/** Charge l'état depuis localStorage */
function load() {
  try {
    state.feeds      = JSON.parse(localStorage.getItem('rss_feeds')    || '[]');
    state.articles   = JSON.parse(localStorage.getItem('rss_articles') || '[]');
    state.readIds    = new Set(JSON.parse(localStorage.getItem('rss_read')   || '[]'));
    state.podcasts   = JSON.parse(localStorage.getItem('rss_podcasts') || '[]');
    state.savedIds   = new Set(JSON.parse(localStorage.getItem('rss_saved')  || '[]'));
    state.episodes   = JSON.parse(localStorage.getItem('rss_episodes') || '[]');
    state.feedHealth = JSON.parse(localStorage.getItem('rss_feed_health') || '{}');
    state.settings   = {
      markRead: true,
      showImages: true,
      ...JSON.parse(localStorage.getItem('rss_settings') || '{}'),
    };
    savedAcademicArticles = JSON.parse(localStorage.getItem('rss_ac_saved') || '[]');
  } catch (err) {
    console.error('[load] Erreur chargement localStorage:', err);
  }
}


// ══════════════════════════════════════════════
//  3. LAYOUT — Navigation et mise en page
// ══════════════════════════════════════════════

// Position de scroll mémorisée par vue
const _scrollPositions = {};

function saveScrollPos(id, top) {
  _scrollPositions[id] = top;
}

function restoreScrollPos(id) {
  const el = document.getElementById(id);
  if (el && _scrollPositions[id]) {
    requestAnimationFrame(() => { el.scrollTop = _scrollPositions[id]; });
  }
}

function setSwipeHeight() {
  const nav = document.querySelector('.bottom-nav');
  const mini = document.getElementById('miniPlayer');
  const navH = nav ? nav.offsetHeight : 60;
  const miniH = (mini && mini.classList.contains('visible')) ? mini.offsetHeight : 0;

  // Header fixe unique
  const refHeader = document.getElementById('fixedHeader');
  const headerH = refHeader ? refHeader.offsetHeight : 70;

  if (headerH < 10 || navH < 10) return; // pas encore rendu

  // Positionner le swipeContainer
  const container = document.getElementById('swipeContainer');
  if (!container) return;
  container.style.top = headerH + 'px';
  container.style.bottom = (navH + miniH) + 'px';
  if (mini) mini.style.bottom = navH + 'px';

  const containerH = container.offsetHeight;
  if (containerH < 50) return;

  // Pour chaque swipe-view : mesurer les fixed et donner le reste au scroll
  document.querySelectorAll('.swipe-view').forEach(view => {
    // Calculer la hauteur fixe (éléments non-scrollables au premier niveau)
    var fixedH = 0;
    Array.from(view.children).forEach(function(child) {
      var isScroll = child.classList.contains('scroll-area')
        || child.id === 'podcastList' || child.id === 'episodeList'
        || child.classList.contains('search-results-area');
      if (!isScroll) fixedH += child.offsetHeight;
    });

    var scrollH = containerH - fixedH;
    if (scrollH < 50) return;

    // Appliquer aux scroll-areas directs
    view.querySelectorAll('.scroll-area, .search-results-area').forEach(function(sa) {
      sa.style.height = scrollH + 'px';
      sa.style.minHeight = scrollH + 'px';
      sa.style.flex = 'none';
      sa.style.overflowY = 'auto';
    });
    ['podcastList', 'episodeList'].forEach(function(id) {
      var el = view.querySelector('#' + id);
      if (el) { el.style.height = scrollH + 'px'; el.style.flex = 'none'; el.style.overflowY = 'auto'; }
    });
  });
}

function getSwipeIdx(name) { return SWIPE_VIEWS.indexOf(name); }

function showView(name) {
  const isSwipeable = SWIPE_VIEWS.includes(name);

  // Nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');

  // Switcher le header fixe
  ['flux','search','podcast','feeds'].forEach(v => {
    const el = document.getElementById('hdr-' + v);
    if (el) el.style.display = v === name ? '' : 'none';
  });

  if (isSwipeable) {
    // Animer le swipeContainer
    const idx = getSwipeIdx(name);
    const container = document.getElementById('swipeTrack');
    container.classList.add('snapping');
    setTimeout(() => container.classList.remove('snapping'), 350);
    container.style.transform = 'translateX(-' + (idx * 100) + 'vw)';

    // Cacher settings si visible
    document.getElementById('settingsView').classList.remove('active');

  } else {
    // Settings : slide depuis la droite, le swipe reste en dessous
    document.getElementById('settingsView').classList.add('active');
  }

  // Actions spécifiques
  if (name === 'feeds') {
    renderFeeds();
    // S'assurer que le panel flux est visible par défaut
    var srcFlux = document.getElementById('srcFluxPanel');
    var srcPod  = document.getElementById('srcPodPanel');
    if (srcFlux) srcFlux.style.display = '';
    if (srcPod)  srcPod.style.display  = 'none';
    var tabFlux = document.getElementById('src-tab-flux');
    var tabPod  = document.getElementById('src-tab-pod');
    if (tabFlux) tabFlux.classList.add('active');
    if (tabPod)  tabPod.classList.remove('active');
  }
  if (name === 'settings') {
    document.getElementById('cacheCount').textContent = state.articles.length + ' articles';
    document.getElementById('toggleRead').classList.toggle('on', state.settings.markRead);
    document.getElementById('toggleImages').classList.toggle('on', state.settings.showImages);
  }
  if (name === 'search') {
    updateContextInfo();
    updateFluxSelectorLabel();
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) document.getElementById('searchViewInput')?.focus();
  }
  // Recalculer la hauteur après changement de vue
  requestAnimationFrame(() => { setSwipeHeight(); setTimeout(setSwipeHeight, 150); });

  state.currentView = name;
  // Recalculer hauteur après changement de vue
  requestAnimationFrame(function() { try { setSwipeHeight(); } catch(e) {} });
}

// ── Swipe touch handler ──
let _touchStartX  = 0;
let _touchStartY  = 0;
let _touchStartT  = 0;
let _isHorizSwipe = null;
let _baseTranslate = 0;

(function initSwipe() {
  const container = document.getElementById('swipeContainer');
  if (!container) return;

  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _touchStartX  = e.touches[0].clientX;
    _touchStartY  = e.touches[0].clientY;
    _touchStartT  = Date.now();
    _isHorizSwipe = null;
    _baseTranslate = getSwipeIdx(state.currentView || 'flux') * 100;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - _touchStartX;
    const dy = e.touches[0].clientY - _touchStartY;

    if (_isHorizSwipe === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      _isHorizSwipe = Math.abs(dx) > Math.abs(dy);
    }
    if (!_isHorizSwipe) return;

    e.preventDefault();
    const pct = (dx / window.innerWidth) * 100;
    let newT = _baseTranslate - pct;
    const maxT = (SWIPE_VIEWS.length - 1) * 100;
    if (newT < 0)    newT = newT * 0.2;
    if (newT > maxT) newT = maxT + (newT - maxT) * 0.2;

    const track = document.getElementById('swipeTrack');
    track.classList.remove('snapping');
    track.style.transform = `translateX(-${newT}vw)`;
  }, { passive: false });

  container.addEventListener('touchend', e => {
    if (!_isHorizSwipe) return;
    const dx = e.changedTouches[0].clientX - _touchStartX;
    const dt = Date.now() - _touchStartT;
    const velocity = Math.abs(dx) / dt;

    const curIdx = getSwipeIdx(state.currentView || 'flux');
    let targetIdx = curIdx;
    if (dx < -50 || (dx < -10 && velocity > 0.3)) targetIdx = Math.min(curIdx + 1, SWIPE_VIEWS.length - 1);
    if (dx >  50 || (dx >  10 && velocity > 0.3)) targetIdx = Math.max(curIdx - 1, 0);
    showView(SWIPE_VIEWS[targetIdx]);
  }, { passive: true });
})();

// ── Initialisation hauteur ──
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => setSwipeHeight());
  const hdr = document.getElementById('fixedHeader');
  const nav = document.querySelector('.bottom-nav');
  if (hdr) ro.observe(hdr);
  if (nav) ro.observe(nav);
} else {
  setTimeout(setSwipeHeight, 100);
  setTimeout(setSwipeHeight, 500);
}
window.addEventListener('resize', setSwipeHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setSwipeHeight);
}


// ══════════════════════════════════════════════
//  4. FEEDS — Flux RSS, articles, explorateur
// ══════════════════════════════════════════════


async function proxyFetch(targetUrl) {
  let lastErr;
  for (const proxyFn of CORS_PROXIES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(proxyFn(targetUrl), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch(e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr || new Error('Tous les proxies ont échoué');
}

async function fetchRaw(url) {
  return await proxyFetch(url);
}

function isFeedContent(text) {
  const s = (text || '').trimStart();
  if (s.startsWith('<?xml') || s.startsWith('<rss') || s.startsWith('<feed') || s.startsWith('<atom')) return true;
  try { const j = JSON.parse(s); if (j.version && j.items) return true; } catch(_) {}
  return false;
}

function isLikelyFeedUrl(url) {
  return /\.(xml|rss|atom)$/i.test(url) ||
    /\/(feed|rss|atom)(\/|$|\?)/i.test(url) ||
    /\?feed=/i.test(url) ||
    /feeds\./i.test(new URL(url).hostname);
}

function platformFeedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    const host = u.hostname.replace('www.', '');
    const path = u.pathname;

    // YouTube channel/user/playlist
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const chMatch = path.match(/\/@([^/]+)/);
      const idMatch = path.match(/\/channel\/([^/]+)/);
      const userMatch = path.match(/\/user\/([^/]+)/);
      const plMatch = u.searchParams.get('list');
      if (plMatch) return [`https://www.youtube.com/feeds/videos.xml?playlist_id=${plMatch}`];
      if (chMatch) return [`https://www.youtube.com/feeds/videos.xml?user=${chMatch[1]}`];
      if (idMatch) return [`https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`];
      if (userMatch) return [`https://www.youtube.com/feeds/videos.xml?user=${userMatch[1]}`];
    }
    // Reddit
    if (host === 'reddit.com') {
      return [rawUrl.replace(/\/?$/, '') + '.rss'];
    }
    // GitHub releases
    if (host === 'github.com') {
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) return [`https://github.com/${parts[0]}/${parts[1]}/releases.atom`];
    }
  } catch(e) {}
  return null;
}

function parseFeed(text, url) {
  if (!text || text.trim().length < 50) throw new Error('Contenu vide');
  // JSON Feed
  try {
    const jf = JSON.parse(text);
    if (jf.version && jf.items) {
      return {
        title: jf.title || '',
        items: (jf.items || []).map(function(item) {
          return {
            title:       item.title || item.summary || '(Sans titre)',
            link:        item.url || item.external_url || '',
            description: item.content_html || item.content_text || item.summary || '',
            date:        item.date_published || item.date_modified || '',
            image:       item.image || '',
            id:          item.id || item.url || '',
          };
        }),
      };
    }
  } catch(e2) {}
  // XML
  var doc;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html');
  } catch(e3) { throw new Error('XML parse failed'); }
  // Atom
  if (doc.querySelector('feed > entry, feed')) {
    var feedTitle = doc.querySelector('feed > title') ? doc.querySelector('feed > title').textContent.trim() : '';
    var entries = doc.querySelectorAll('entry');
    var atomItems = [];
    entries.forEach(function(e) {
      var link = e.querySelector('link[rel="alternate"]') ? e.querySelector('link[rel="alternate"]').getAttribute('href')
               : e.querySelector('link:not([rel])') ? e.querySelector('link:not([rel])').getAttribute('href')
               : e.querySelector('link') ? e.querySelector('link').getAttribute('href') : '';
      var cnt = e.querySelector('content') ? e.querySelector('content').textContent
              : e.querySelector('summary') ? e.querySelector('summary').textContent : '';
      var imgM = cnt.match(/<img[^>]+src=["']([^"']+)["']/i);
      atomItems.push({
        title:       e.querySelector('title') ? e.querySelector('title').textContent.trim() : '(Sans titre)',
        link:        link,
        description: cnt,
        date:        e.querySelector('updated') ? e.querySelector('updated').textContent
                   : e.querySelector('published') ? e.querySelector('published').textContent : '',
        image:       imgM ? imgM[1] : '',
        id:          e.querySelector('id') ? e.querySelector('id').textContent : link,
      });
    });
    return { title: feedTitle, items: atomItems };
  }
  // RSS 2.0
  var channel = doc.querySelector('channel');
  if (!channel) throw new Error('Format non reconnu');
  var rssTitle = channel.querySelector('title') ? channel.querySelector('title').textContent.trim() : '';
  try { if (!rssTitle) rssTitle = new URL(url).hostname; } catch(e4) {}
  var rssItems = [];
  doc.querySelectorAll('item').forEach(function(item) {
    var rawContent = item.querySelector('encoded') ? item.querySelector('encoded').textContent
                   : item.querySelector('description') ? item.querySelector('description').textContent : '';
    var imgM2 = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    var thumb = item.querySelector('thumbnail') ? item.querySelector('thumbnail').getAttribute('url') : '';
    var enc = item.querySelector('enclosure');
    var encUrl = enc ? enc.getAttribute('url') : '';
    var isImg = enc && enc.getAttribute('type') ? enc.getAttribute('type').startsWith('image') : false;
    rssItems.push({
      title:       item.querySelector('title') ? item.querySelector('title').textContent.trim() : '(Sans titre)',
      link:        item.querySelector('link') ? item.querySelector('link').textContent.trim() : '',
      description: rawContent,
      date:        item.querySelector('pubDate') ? item.querySelector('pubDate').textContent.trim()
                 : item.querySelector('date') ? item.querySelector('date').textContent.trim() : '',
      image:       thumb || (isImg ? encUrl : '') || (imgM2 ? imgM2[1] : ''),
      id:          item.querySelector('guid') ? item.querySelector('guid').textContent.trim() : '',
    });
  });
  return { title: rssTitle, items: rssItems };
}

function extractImage(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

async function fetchFeed(url) {
  const text = await proxyFetch(url);
  return parseFeed(text, url);
}

function normalizeTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
}

function mergeArticles(existing, incoming) {
  const existingIds = new Set(existing.map(a => a.id));
  // Détection doublons par titre normalisé (même article republié avec ID différent)
  const existingTitles = new Set(
    existing.slice(0, 200).map(a => normalizeTitle(a.title)) // vérifier sur les 200 plus récents
  );
  const fresh = incoming.filter(a => {
    if (existingIds.has(a.id)) return false; // doublon exact
    const nt = normalizeTitle(a.title);
    if (nt.length > 10 && existingTitles.has(nt)) return false; // doublon de titre
    return true;
  });
  return [...fresh, ...existing].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function loadFeedArticles(feed) {
  let text = null;
  try { const r = await fetch(feed.url); if (r.ok) text = await r.text(); } catch(_) {}
  if (!text || !isFeedContent(text)) {
    try { text = await proxyFetch(feed.url); } catch(_) {}
  }
  if (!text) return;
  try {
    const data = parseFeed(text, feed.url);
    const newArticles = (data.items || []).map(item => ({
      ...item, feedId: feed.id, feedName: feed.name, feedColor: feed.color,
      id: item.link || (feed.id + item.title),
    }));
    state.articles = mergeArticles(state.articles, newArticles);
    save();
    renderArticles();
    if (newArticles.length) showToast('✓ ' + newArticles.length + ' articles chargés');
  } catch(_) {}
}

async function discoverFeed() {
  let raw = document.getElementById('feedUrlInput').value.trim();
  if (!raw) { showToast('Entrez une adresse'); return; }

  // Si ça ressemble à un nom de site (contient espaces ou accents, pas de point de domaine)
  // on le transforme en nom de domaine probable
  if (!raw.includes('://') && !raw.match(/^[\w.-]+\.[a-z]{2,}/i)) {
    // Convertir "collège de france" → "college-de-france.fr" tentatives
    const slug = raw.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlever accents
      .replace(/[^a-z0-9\s-]/g, '').trim()
      .replace(/\s+/g, '-');
    raw = slug; // sera préfixé https:// ci-dessous
  }

  if (!raw.includes('://')) raw = 'https://' + raw;
  // Normalize trailing slash for root URLs
  try { const u = new URL(raw); if (u.pathname === '') u.pathname = '/'; raw = u.href; } catch(e) {
    // URL toujours invalide : essayer avec .fr et .com
    const slug = raw.replace('https://', '').replace('http://', '');
    raw = 'https://' + slug.replace(/\..*$/, '') + '.fr';
    try { new URL(raw); } catch(e2) { showToast('Adresse invalide'); return; }
  }

  const btn = document.getElementById('discoverBtn');
  btn.disabled = true;
  btn.textContent = '…';

  const panel = document.getElementById('discoveryPanel');
  const resultsEl = document.getElementById('discoveryResults');
  panel.classList.add('visible');
  resultsEl.innerHTML = `<div class="discovery-status"><div class="spinner"></div> Recherche en cours…</div>`;
  document.getElementById('discoveryHeader').textContent = 'Recherche…';

  try {
    const found = [];
    const tried = new Set();

    async function tryFeed(u, title='') {
      if (tried.has(u)) return;
      tried.add(u);
      try {
        const text = await fetchRaw(u);
        if (!isFeedContent(text)) return;
        const feed = parseFeed(text, u);
        if (feed.items?.length) found.push({ url: u, title: title || feed.title, count: feed.items.length });
      } catch(e) {}
    }

    // 1. Platform shortcuts
    const shortcuts = platformFeedUrl(raw);
    if (shortcuts) {
      await Promise.all(shortcuts.map(u => tryFeed(u)));
    }

    // 2. Lancer EN PARALLÈLE : URL directe + scraping page + sondage suffixes
    const origin = (() => { try { return new URL(raw).origin; } catch(e) { return null; } })();

    const tasks = [];

    // URL directe si feed-like
    if (isLikelyFeedUrl(raw)) tasks.push(tryFeed(raw));

    // Scraping page HTML
    tasks.push((async () => {
      try {
        const pageText = await fetchRaw(raw);
        const candidates = [
          ...extractFeedLinksFromHtml(pageText, raw),
          ...extractFeedUrlsFromBody(pageText, raw),
        ];
        const seen = new Set();
        const unique = candidates.filter(c => { if (seen.has(c.url)) return false; seen.add(c.url); return true; });
        await Promise.all(unique.slice(0, 6).map(c => tryFeed(c.url, c.title)));
      } catch(e) {}
    })());

    // Sondage suffixes en parallèle
    if (origin) {
      tasks.push(Promise.all(RSS_SUFFIXES.map(s => tryFeed(origin + s))));
    }

    await Promise.all(tasks);

    if (!found.length) {
      resultsEl.innerHTML = `<div class="discovery-status">😕 Aucun flux RSS trouvé pour ce site.</div>`;
      document.getElementById('discoveryHeader').textContent = 'Aucun résultat';
    } else {
      document.getElementById('discoveryHeader').textContent = found.length + ' flux trouvé' + (found.length > 1 ? 's' : '');
      resultsEl.innerHTML = found.map((f, i) => `
        <div class="discovery-item">
          <i class="ti ti-rss disc-icon"></i>
          <div class="disc-info">
            <div class="disc-name">${f.title || new URL(f.url).hostname}</div>
            <div class="disc-url">${f.url}</div>
          </div>
          <button class="disc-add" onclick="confirmAddFeed('${encodeURIComponent(f.url)}','${encodeURIComponent(f.title||'')}')">＋ Ajouter</button>
        </div>
      `).join('');
    }
  } catch(e) {
    resultsEl.innerHTML = `<div class="discovery-status">⚠️ Erreur lors de la recherche.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Chercher';
  }
}

async function tryFeed(u, title='') {
      if (tried.has(u)) return;
      tried.add(u);
      try {
        const text = await fetchRaw(u);
        if (!isFeedContent(text)) return;
        const feed = parseFeed(text, u);
        if (feed.items?.length) found.push({ url: u, title: title || feed.title, count: feed.items.length });
      } catch(e) {}
    }

function extractFeedLinksFromHtml(html, baseUrl) {
  const results = [];
  // Match <link> tags with RSS/Atom type
  const linkRe = /<link([^>]+)>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const attrs = m[1];
    const typeM = attrs.match(/type=["']([^"']+)["']/i);
    const hrefM = attrs.match(/href=["']([^"']+)["']/i);
    const titleM = attrs.match(/title=["']([^"']+)["']/i);
    if (typeM && hrefM && /rss|atom|xml/i.test(typeM[1])) {
      let href = hrefM[1];
      if (href.startsWith('//')) href = 'https:' + href;
      else if (href.startsWith('/')) href = new URL(baseUrl).origin + href;
      else if (!href.startsWith('http')) href = new URL(baseUrl).origin + '/' + href;
      results.push({ url: href, title: titleM ? titleM[1] : '' });
    }
  }
  return results;
}

function extractFeedUrlsFromBody(html, baseUrl) {
  const results = [];
  const origin = new URL(baseUrl).origin;
  // Match any href="..." that looks like a feed path
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let href = m[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;
    if (href.startsWith('//')) href = 'https:' + href;
    else if (href.startsWith('/')) href = origin + href;
    else if (!href.startsWith('http')) continue;
    // Only keep if it looks like a feed URL
    try {
      const u = new URL(href);
      if (u.origin !== origin) continue; // same-site only
      if (isLikelyFeedUrl(href)) results.push({ url: href, title: '' });
    } catch(e) {}
  }
  return results;
}

async function confirmAddFeed(encodedUrl, encodedName) {
  const url = decodeURIComponent(encodedUrl);
  const name = decodeURIComponent(encodedName);
  await addFeed(url, name);
}

async function importFeedFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  showToast('Lecture du fichier…');
  try {
    const text = await file.text();
    if (!isFeedContent(text)) {
      showToast('Format non reconnu (.atom, .xml, .rss, .json)');
      return;
    }
    const feed = parseFeed(text, file.name);
    if (!feed.items?.length) { showToast('Aucun article trouvé dans ce fichier'); return; }

    const colorIdx = state.feeds.length % FEED_COLORS.length;
    const feedName = feed.title || file.name.replace(/\.[^.]+$/, '');
    // Générer un ID unique basé sur le nom (pas d'URL)
    const feedId = 'local_' + Date.now();
    const newFeed = { id: feedId, url: 'local:' + file.name, name: feedName, color: FEED_COLORS[colorIdx] };

    if (state.feeds.find(f => f.name === feedName)) {
      showToast('Ce flux est déjà importé');
      return;
    }

    state.feeds.push(newFeed);
    const newArticles = (feed.items || []).map(item => ({
      ...item,
      feedId: newFeed.id,
      feedName: newFeed.name,
      feedColor: newFeed.color,
      id: item.link || (newFeed.id + item.title),
    }));
    state.articles = mergeArticles(state.articles, newArticles);
    save();
    renderFeeds();
    renderArticles();
    updateFilterTabs();
    showToast('✓ ' + feed.items.length + ' articles importés depuis ' + feedName);
  } catch(e) {
    showToast('Erreur lors de la lecture du fichier');
  }
  // Reset input pour pouvoir réimporter le même fichier
  event.target.value = '';
}

async function addFeed(url, name) {
  if (!url) { showToast('Entrez une adresse'); return; }
  if (!url.startsWith('http')) url = 'https://' + url;
  if (state.feeds.find(f => f.url === url)) { showToast('Ce flux est déjà ajouté'); return; }

  showToast('Ajout en cours…');
  try {
    const feed = await fetchFeed(url);
    const colorIdx = state.feeds.length % FEED_COLORS.length;
    const newFeed = {
      id: Date.now().toString(),
      url,
      name: name || feed.title || new URL(url).hostname,
      color: FEED_COLORS[colorIdx],
    };
    state.feeds.push(newFeed);
    const newArticles = (feed.items || []).map(item => ({
      ...item,
      feedId: newFeed.id,
      feedName: newFeed.name,
      feedColor: newFeed.color,
      id: item.link || (newFeed.id + item.title),
    }));
    state.articles = mergeArticles(state.articles, newArticles);
    save();
    document.getElementById('feedUrlInput').value = '';
    document.getElementById('discoveryPanel').classList.remove('visible');
    renderFeeds();
    renderArticles();
    updateFilterTabs();
    showToast('✓ Flux ajouté : ' + newFeed.name);
  } catch(e) {
    showToast('Impossible de charger ce flux');
  }
}

function removeFeed(id) {
  if (!confirm('Supprimer ce flux et ses articles ?')) return;
  state.feeds = state.feeds.filter(f => f.id !== id);
  // Conserver les articles marqués "À lire" même si le flux est supprimé
  state.articles = state.articles.filter(a => {
    if (a.feedId !== id) return true;
    return state.savedIds.has(a.id); // garder si "à lire"
  });
  // Marquer les articles conservés comme "hors-flux" pour l'affichage
  state.articles = state.articles.map(a => {
    if (a.feedId === id && state.savedIds.has(a.id)) {
      return { ...a, feedName: a.feedName + ' (archivé)', feedColor: '#888888' };
    }
    return a;
  });
  save();
  renderFeeds();
  renderArticles();
  updateFilterTabs();
  showToast('Flux supprimé');
}

async function refreshAll() {
  if (!state.feeds.length) { showToast('Ajoutez d\'abord des flux'); return; }
  const btn = document.getElementById('rssAnim');
  btn.style.opacity = '0.5';
  showToast('Actualisation…');
  let errCount = 0;
  try {
    await Promise.allSettled(state.feeds.map(async feed => {
      try {
        const data = await fetchFeed(feed.url);
        const newArticles = (data.items || []).map(item => ({
          ...item,
          feedId: feed.id,
          feedName: feed.name,
          feedColor: feed.color,
          id: item.link || (feed.id + item.title),
        }));
        state.articles = mergeArticles(state.articles, newArticles);
      } catch(e) {}
    }));
    save();
    localStorage.setItem('rss_last_refresh', Date.now().toString());
    renderArticles();
    renderFeeds(); // mettre à jour les indicateurs de santé
    showToast(errCount > 0
      ? '✓ Actualisé · ' + errCount + ' flux en erreur ⚠'
      : '✓ Tous les flux actualisés');
  } finally {
    if (btn) btn.style.opacity = '';
  }
}

function getFilteredArticles() {
  // Filtre de la vue Flux — PAS de filtre période ici (uniquement dans Recherche)
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const { inTitle, inBody } = state.search;

  return state.articles.filter(a => {
    if (state.activeFilter === 'unread' && state.readIds.has(a.id)) return false;
    if (state.activeFilter === 'later' && !state.savedIds.has(a.id)) return false;
    const ff = state.activeFilter;
    if (ff !== 'all' && ff !== 'unread' && ff !== 'later' && a.feedId !== ff) return false;

    if (q) {
      const inT = inTitle && (a.title || '').toLowerCase().includes(q);
      const inB = inBody && (a.description || '').toLowerCase().includes(q);
      if (!inT && !inB) return false;
    }

    return true;
  });
}

function filterArticles() {
  // Si on est en vue fluxlist, revenir aux articles pour montrer les résultats
  if (state.mainTab === 'fluxlist') {
    state.mainTab = 'articles';
    state.activeFilter = 'all';
    document.getElementById('fluxPanel').classList.remove('active');
    document.getElementById('articleList').style.display = '';
    document.getElementById('feedSubHeader').style.display = 'none';
    updateFilterTabs();
  }
  renderArticles();
}

function showFluxList() {
  state.mainTab = 'fluxlist';
  state.activeFilter = 'all';
  // Update tabs UI
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabFluxList').classList.add('active');
  // Show flux panel, hide articles
  document.getElementById('fluxPanel').classList.add('active');
  document.getElementById('articleList').style.display = 'none';
  document.getElementById('feedSubHeader').style.display = 'none';
  var _sb = document.querySelector('.search-bar'); if (_sb) _sb.style.display = 'none';
  var _sa = document.getElementById('searchAdv'); if (_sa) { _sa.classList.remove('open'); _sa.style.display = 'none'; }
  // Header
  document.getElementById('articleCountLabel').textContent = state.feeds.length + ' source' + (state.feeds.length > 1 ? 's' : '');
  renderFluxPanel();
}

function showArticleList() {
  state.mainTab = 'articles';
  document.getElementById('fluxPanel').classList.remove('active');
  document.getElementById('articleList').style.display = '';
  var _sb2 = document.querySelector('.search-bar'); if (_sb2) _sb2.style.display = '';
}

function backToAll() {
  state.activeFilter = 'all';
  document.getElementById('feedSubHeader').style.display = 'none';
  showArticleList();
  updateFilterTabs();
  renderArticles();
}

function openFeedFilter(feedId) {
  state.activeFilter = feedId;
  state.mainTab = 'articles';
  const feed = state.feeds.find(f => f.id === feedId);
  const today = new Date(); today.setHours(0,0,0,0);
  const total = state.articles.filter(a => a.feedId === feedId).length;
  const todayCount = state.articles.filter(a => a.feedId === feedId && new Date(a.date) >= today).length;
  // Show sub-header
  document.getElementById('feedSubTitle').textContent = feed ? feed.name : '';
  document.getElementById('feedSubMeta').textContent = total + ' article' + (total>1?'s':'') + (todayCount > 0 ? ' · ' + todayCount + ' aujourd\'hui' : '');
  document.getElementById('feedSubHeader').style.display = 'flex';
  // Switch to article list
  document.getElementById('fluxPanel').classList.remove('active');
  document.getElementById('articleList').style.display = '';
  var _sb3 = document.querySelector('.search-bar'); if (_sb3) _sb3.style.display = '';
  // Deselect all tabs
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  renderArticles();
}

function updateFilterTabs() {
  const tabs = document.getElementById('filterTabs');
  const feedTabs = state.feeds.map(f => {
    const count = state.articles.filter(a => a.feedId === f.id && !state.readIds.has(a.id)).length;
    return `<button class="tab ${state.activeFilter === f.id ? 'active' : ''}" onclick="filterBy('${f.id}', this)">${f.name}${count > 0 ? `<span class="badge">${count}</span>` : ''}</button>`;
  }).join('');
  tabs.innerHTML = `
    <button class="tab ${state.mainTab === 'fluxlist' ? 'active' : ''}" id="tabFluxList" onclick="showFluxList()"><i class="ti ti-layout-list" style="font-size:12px;vertical-align:-1px;margin-right:3px;"></i>Flux</button>
    <button class="tab ${state.activeFilter === 'all' && state.mainTab !== 'fluxlist' ? 'active' : ''}" onclick="filterBy('all',this)">Tous</button>
    <button class="tab ${state.activeFilter === 'unread' ? 'active' : ''}" onclick="filterBy('unread',this)">Non lus</button>
    <button class="tab ${state.activeFilter === 'later' ? 'active' : ''}" onclick="filterBy('later',this)"><i class="ti ti-bookmark" style="font-size:12px;vertical-align:-1px;margin-right:3px;"></i>À lire${state.savedIds.size > 0 ? `<span class="badge">${state.savedIds.size}</span>` : ''}</button>
  `;
}

function renderFluxPanel() {
  const el = document.getElementById('fluxPanel');
  if (!state.feeds.length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-rss empty-icon"></i><div class="empty-title">Aucun flux</div><div class="empty-sub">Ajoutez des sources dans l\'onglet Sources.</div></div>';
    return;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  el.innerHTML = state.feeds.map(f => {
    const todayCount = state.articles.filter(a => a.feedId === f.id && new Date(a.date) >= today).length;
    const totalCount = state.articles.filter(a => a.feedId === f.id).length;
    const unread = state.articles.filter(a => a.feedId === f.id && !state.readIds.has(a.id)).length;
    return `<div class="flux-source-card" onclick="openFeedFilter('${f.id}')">
      <div class="flux-source-icon" style="background:${f.color}22">
        <i class="ti ti-rss" style="color:${f.color};font-size:20px;"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div class="flux-source-name">${f.name}</div>
        <div class="flux-source-meta">${totalCount} article${totalCount>1?'s':''} · ${unread} non lu${unread>1?'s':''}</div>
      </div>
      <div class="flux-today-badge ${todayCount === 0 ? 'none' : ''}">
        ${todayCount > 0 ? todayCount + ' auj.' : 'aucun auj.'}
      </div>
      <i class="ti ti-chevron-right" style="color:var(--text-muted);font-size:16px;margin-left:6px;"></i>
    </div>`;
  }).join('');
}

function renderFeeds() {
  // Feed list
  const el = document.getElementById('feedList');
  if (!state.feeds.length) {
    el.innerHTML = '<div class="empty-state" style="padding:30px"><i class="ti ti-world empty-icon"></i><div class="empty-title">Aucun flux</div></div>';
    document.getElementById('feedCountLabel').textContent = '0 flux';
    return;
  }
  document.getElementById('feedCountLabel').textContent = state.feeds.length + ' flux';
  el.innerHTML = state.feeds.map(f => {
    const count = state.articles.filter(a => a.feedId === f.id && !state.readIds.has(a.id)).length;
    return `<div class="feed-item">
      <div class="feed-icon" style="background:${f.color}22">
        <i class="ti ti-rss" style="font-size:20px;color:var(--text-muted)"></i>
      </div>
      <div class="feed-info">
        <div class="feed-name">${f.name}</div>
        <div class="feed-url">${f.url}</div>
      </div>
      ${count > 0 ? `<div class="feed-count">${count}</div>` : ''}
      <button class="feed-del" onclick="removeFeed('${f.id}')">✕</button>
    </div>`;
  }).join('');
}

function markAllRead() {
  state.articles.forEach(a => state.readIds.add(a.id));
  save();
  renderArticles();
  updateFilterTabs();
  showToast('Tous les articles marqués lus');
}

function clearAll() {
  if (!confirm('Tout réinitialiser ? Vos flux et articles seront effacés.')) return;
  state.feeds = [];
  state.articles = [];
  state.readIds = new Set();
  state.savedIds = new Set();
  save();
  renderFeeds();
  renderArticles();
  updateFilterTabs();
  showToast('Réinitialisé');
}

function toggleSave(e, id) {
  e.preventDefault();
  e.stopPropagation();
  if (state.savedIds.has(id)) {
    state.savedIds.delete(id);
  } else {
    state.savedIds.add(id);
  }
  save();
  // Mettre à jour uniquement le bouton cliqué, sans reconstruire tout le DOM
  const btn = e.currentTarget;
  if (state.savedIds.has(id)) {
    btn.classList.add('saved');
    btn.innerHTML = '<i class="ti ti-bookmark" style="color:var(--red);fill:var(--red);"></i>';
  } else {
    btn.classList.remove('saved');
    btn.innerHTML = '<i class="ti ti-bookmark"></i>';
  }
  updateFilterTabs();
}

function filterBy(filter, btn) {
  state.activeFilter = filter;
  state.mainTab = 'articles';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('feedSubHeader').style.display = 'none';
  showArticleList();
  renderArticles();
}

async function searchRssFeeds() {
  const q = document.getElementById('rssSearchInput')?.value.trim();
  if (!q) return;
  const resultsEl = document.getElementById('rssExploreResults');
  resultsEl.innerHTML = '<div class="pod-explore-empty"><div class="spinner" style="display:inline-block;margin-right:8px;"></div>Recherche…</div>';

  try {
    // Feedly Search API — publique, pas de clé, pas de CORS
    const url = 'https://cloud.feedly.com/v3/search/feeds?query=' + encodeURIComponent(q) + '&count=20&locale=fr';
    const res = await fetch(url);
    const data = await res.json();

    const results = data.results || [];
    if (!results.length) {
      resultsEl.innerHTML = '<div class="pod-explore-empty">Aucun flux trouvé pour "' + q + '"</div>';
      return;
    }

    const alreadyAdded = new Set(state.feeds.map(f => f.url));

    resultsEl.innerHTML = '<div class="pod-explore-results">' +
      results.map((feed, i) => {
        // Feedly retourne feedId comme "feed/https://..." 
        const feedUrl = (feed.feedId || '').replace(/^feed\//, '');
        const isAdded = feedUrl && alreadyAdded.has(feedUrl);
        const iconHtml = feed.iconUrl
          ? '<img class="pod-explore-art" src="' + feed.iconUrl + '" loading="lazy" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'">'
          : '<div style="width:40px;height:40px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-rss" style="font-size:18px;color:var(--text-muted);"></i></div>';
        const title = feed.title || feed.website || feedUrl;
        const desc = feed.description ? feed.description.slice(0, 80) : (feed.website || '');
        const subs = feed.subscribers ? ' · ' + formatSubscribers(feed.subscribers) + ' abonnés' : '';
        return '<div class="pod-explore-card">'
          + iconHtml
          + '<div class="pod-explore-info">'
          + '<div class="pod-explore-name">' + title + '</div>'
          + '<div class="pod-explore-author">' + desc + subs + '</div>'
          + '</div>'
          + '<button class="pod-add-btn' + (isAdded ? ' added' : '') + '" data-feed="' + feedUrl + '" data-name="' + title.replace(/"/g,'') + '">'
          + (isAdded ? '✓ Suivi' : '+ Suivre')
          + '</button>'
          + '</div>';
      }).join('') + '</div>';

    // Event delegation
    resultsEl.onclick = function(e) {
      const btn = e.target.closest('.pod-add-btn');
      if (!btn || btn.classList.contains('added')) return;
      const feedUrl = btn.dataset.feed;
      const feedName = btn.dataset.name;
      if (!feedUrl) return;
      addFeedFromExplorer(feedUrl, feedName, btn);
    };

  } catch(e) {
    // Fallback : essayer via proxy si Feedly bloque (CORS)
    try {
      const url2 = 'https://cloud.feedly.com/v3/search/feeds?query=' + encodeURIComponent(q) + '&count=20';
      const proxyText = await proxyFetch(url2);
      const data2 = JSON.parse(proxyText);
      if (data2.results?.length) {
        // Réutiliser le même rendu
        const results2 = data2.results;
        const alreadyAdded2 = new Set(state.feeds.map(f => f.url));
        resultsEl.innerHTML = '<div class="pod-explore-results">' +
          results2.map((feed) => {
            const feedUrl = (feed.feedId || '').replace(/^feed\//, '');
            const isAdded = feedUrl && alreadyAdded2.has(feedUrl);
            const iconHtml = feed.iconUrl
              ? '<img class="pod-explore-art" src="' + feed.iconUrl + '" loading="lazy" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'">'
              : '<div style="width:40px;height:40px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-rss" style="font-size:18px;color:var(--text-muted);"></i></div>';
            const title = feed.title || feed.website || feedUrl;
            const desc = (feed.description || feed.website || '').slice(0, 80);
            return '<div class="pod-explore-card">'
              + iconHtml
              + '<div class="pod-explore-info">'
              + '<div class="pod-explore-name">' + title + '</div>'
              + '<div class="pod-explore-author">' + desc + '</div>'
              + '</div>'
              + '<button class="pod-add-btn' + (isAdded ? ' added' : '') + '" data-feed="' + feedUrl + '" data-name="' + title.replace(/"/g, '') + '">'
              + (isAdded ? '✓ Suivi' : '+ Suivre')
              + '</button>'
              + '</div>';
          }).join('') + '</div>';
        resultsEl.onclick = function(e) {
          const btn = e.target.closest('.pod-add-btn');
          if (!btn || btn.classList.contains('added')) return;
          addFeedFromExplorer(btn.dataset.feed, btn.dataset.name, btn);
        };
      } else {
        resultsEl.innerHTML = '<div class="pod-explore-empty">Aucun résultat.</div>';
      }
    } catch(_) {
      resultsEl.innerHTML = '<div class="pod-explore-empty">Erreur de recherche. Vérifiez votre connexion.</div>';
    }
  }
}

function debounceRssSearch() {
  clearTimeout(rssSearchTimer);
  const q = document.getElementById('rssSearchInput')?.value.trim();
  if (!q) {
    document.getElementById('rssExploreResults').innerHTML = '<div class="pod-explore-empty">Recherchez un site, un thème, un journal…</div>';
    return;
  }
  if (q.length < 2) return;
  rssSearchTimer = setTimeout(searchRssFeeds, 450);
}

async function addFeedFromExplorer(feedUrl, feedName, btn) {
  if (state.feeds.find(f => f.url === feedUrl)) {
    btn.textContent = '✓ Suivi'; btn.classList.add('added'); return;
  }

  btn.textContent = '…'; btn.disabled = true;

  // Enregistrer immédiatement
  const colorIdx = state.feeds.length % FEED_COLORS.length;
  const newFeed = {
    id: Date.now().toString(),
    url: feedUrl,
    name: feedName || new URL(feedUrl).hostname,
    color: FEED_COLORS[colorIdx],
  };
  state.feeds.push(newFeed);
  save();
  btn.textContent = '✓ Suivi'; btn.classList.add('added'); btn.disabled = false;
  showToast('✓ ' + newFeed.name + ' ajouté');
  renderFeeds();
  updateFilterTabs();

  // Charger les articles en arrière-plan
  loadFeedArticles(newFeed);
}

function formatSubscribers(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(0) + 'k';
  return n.toString();
}

function setRssSrcTab(tab) {
  const isExplore = tab === 'explore';
  document.getElementById('rss-src-explore').classList.toggle('active', isExplore);
  document.getElementById('rss-src-url').classList.toggle('active', !isExplore);
  document.getElementById('rssExplorePanel').style.display = isExplore ? '' : 'none';
  document.getElementById('rssUrlPanel').style.display = isExplore ? 'none' : '';
}

async function loadDiscoveryArticles(refresh) {
  if (!refresh) {
    // Première fois : afficher la structure et charger en parallèle
    renderDiscoveryShell();
    discoveryArticles = [];
    discoveryBySource = {};
  } else {
    // Actualiser : garder les cartes, juste recharger les articles
    DISCOVERY_FEEDS.forEach(feed => {
      const el = document.getElementById('disc-art-' + feed.name.replace(/\s+/g,'_'));
      if (el) el.innerHTML = '<div class="disc-loading"><div class="spinner"></div></div>';
    });
  }
  await Promise.allSettled(DISCOVERY_FEEDS.map(feed => loadOneSource(feed, refresh)));
}

// ══════════════════════════════════════════════
//  5. PODCASTS — Lecteur et gestion podcasts
// ══════════════════════════════════════════════

let speedIdx = 0;


function parsePodcastFeed(text, url) {
  // Parser en XML d'abord, fallback HTML si parsererror
  let doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(text, 'text/html');
  }

  const ch = doc.querySelector('channel');
  if (!ch) throw new Error('Pas un flux podcast valide');

  // Art : plusieurs emplacements possibles selon le feed
  function qText(selectors) {
    for (const s of selectors) {
      try {
        const el = doc.querySelector(s);
        if (el) {
          const val = el.getAttribute('href') || el.getAttribute('url') || el.textContent?.trim();
          if (val) return val;
        }
      } catch(_) {}
    }
    return '';
  }

  const art = qText(['itunes\:image', 'image url', '[itunes\:image]', 'image > url']);
  const author = qText(['itunes\:author', 'author', 'managingEditor']);
  const title = ch.querySelector('title')?.textContent?.trim() || new URL(url).hostname;

  const items = [...doc.querySelectorAll('item')].map(e => {
    // Chercher l'URL audio dans tous les emplacements connus
    const enc = e.querySelector('enclosure');
    const encType = enc?.getAttribute('type') || '';
    const encUrl = enc?.getAttribute('url') || '';

    // Accepter enclosure audio/* ou enclosure sans type (certains feeds)
    const isAudio = encType.startsWith('audio') || encType === '' || encType.includes('mpeg') || encType.includes('mp3') || encType.includes('ogg') || encType.includes('wav') || encType.includes('aac');
    const audioUrl = (enc && isAudio) ? encUrl : '';

    // Fallback : chercher dans media:content
    const mediaUrl = audioUrl || e.querySelector('content')?.getAttribute('url') || '';

    const dur = e.querySelector('itunes\:duration')?.textContent?.trim() || '';
    const episodeArt = e.querySelector('itunes\:image')?.getAttribute('href') || art;

    return {
      title: e.querySelector('title')?.textContent?.trim() || '(Sans titre)',
      audioUrl: mediaUrl,
      link: e.querySelector('link')?.textContent?.trim() || '',
      description: e.querySelector('description')?.textContent?.trim()
                || e.querySelector('summary')?.textContent?.trim() || '',
      date: e.querySelector('pubDate')?.textContent?.trim() || '',
      duration: dur,
      image: episodeArt,
    };
  })
  // Garder même les items sans audioUrl (on les affiche quand même)
  .filter(e => e.title && e.title !== '(Sans titre)');

  return { title, art, author, items };
}

async function searchPodcasts() {
  const q = document.getElementById('podSearchInput')?.value.trim();
  if (!q) return;
  const resultsEl = document.getElementById('podExploreResults');
  resultsEl.innerHTML = '<div class="pod-explore-empty"><div class="spinner" style="display:inline-block;margin-right:8px;"></div>Recherche en cours…</div>';

  try {
    // iTunes Search API — pas besoin de proxy CORS, Apple autorise cross-origin
    const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=podcast&limit=15&lang=fr_fr';
    const res = await fetch(url);
    const data = await res.json();

    if (!data.results?.length) {
      resultsEl.innerHTML = '<div class="pod-explore-empty">Aucun podcast trouvé pour "' + q + '"</div>';
      return;
    }

    const alreadyAdded = new Set(state.podcasts.map(p => p.url));

    resultsEl.innerHTML = '<div class="pod-explore-results">' +
      data.results.map((pod, i) => {
        const isAdded = pod.feedUrl && alreadyAdded.has(pod.feedUrl);
        const artUrl = (pod.artworkUrl600 || pod.artworkUrl100 || '').replace('100x100', '200x200');
        return '<div class="pod-explore-card" data-idx="' + i + '" data-itunes-id="' + (pod.collectionId || '') + '">'
          + (artUrl ? '<img class="pod-explore-art" src="' + artUrl + '" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="pod-explore-art" style="display:flex;align-items:center;justify-content:center;"><i class="ti ti-microphone" style="font-size:20px;color:var(--text-muted);"></i></div>')
          + '<div class="pod-explore-info">'
          + '<div class="pod-explore-name">' + (pod.collectionName || '—') + '</div>'
          + '<div class="pod-explore-author">' + (pod.artistName || '') + '</div>'
          + '</div>'
          + '<button class="pod-add-btn' + (isAdded ? ' added' : '') + '" data-feed="' + (pod.feedUrl || '') + '" data-name="' + (pod.collectionName || '') + '" data-art="' + artUrl + '" data-author="' + (pod.artistName || '') + '">'
          + (isAdded ? '✓ Ajouté' : '+ Suivre')
          + '</button>'
          + '</div>';
      }).join('') + '</div>';

    // Event delegation pour les boutons Suivre
    resultsEl.onclick = function(e) {
      const btn = e.target.closest('.pod-add-btn');
      if (!btn || btn.classList.contains('added')) return;
      const feedUrl = btn.dataset.feed;
      if (!feedUrl) { showToast('Ce podcast n\'a pas de flux RSS disponible'); return; }
      addPodcastFromExplorer(feedUrl, btn.dataset.name, btn.dataset.art, btn.dataset.author, btn);
    };

  } catch(e) {
    resultsEl.innerHTML = '<div class="pod-explore-empty">Erreur de recherche. Vérifiez votre connexion.</div>';
  }
}

function debouncePodSearch() {
  clearTimeout(podSearchTimer);
  const q = document.getElementById('podSearchInput')?.value.trim();
  if (!q) {
    document.getElementById('podExploreResults').innerHTML = '<div class="pod-explore-empty">Recherchez un podcast par nom ou auteur</div>';
    return;
  }
  if (q.length < 2) return;
  podSearchTimer = setTimeout(searchPodcasts, 400);
}

async function addPodcastFromExplorer(feedUrl, name, art, author, btn) {
  if (state.podcasts.find(p => p.url === feedUrl)) {
    btn.textContent = '✓ Ajouté'; btn.classList.add('added');
    return;
  }

  // Récupérer l'iTunes ID depuis le bouton parent si disponible
  const itunesId = btn.closest('[data-itunes-id]')?.dataset.itunesId || '';

  // 1. Enregistrer immédiatement le podcast avec les infos iTunes
  const pod = {
    id: Date.now().toString(),
    url: feedUrl,
    name: name || 'Podcast',
    art: art || '',
    author: author || '',
    itunesId: itunesId
  };
  state.podcasts.push(pod);
  save();

  btn.textContent = '✓ Ajouté'; btn.classList.add('added'); btn.disabled = false;
  renderPodcastView();
  renderPodcastSourceList();
  showToast('✓ ' + pod.name + ' ajouté');

  // 2. Charger les épisodes en arrière-plan (fetch direct d'abord, puis proxy si échec)
  loadPodcastEpisodes(pod);
}

async function loadPodcastEpisodes(pod) {
  let episodes = null;

  // Stratégie 0 : iTunes API (CORS-free, très fiable)
  // Récupère les 50 derniers épisodes via l'API Apple
  if (pod.itunesId) {
    try {
      const url = 'https://itunes.apple.com/lookup?id=' + pod.itunesId + '&entity=podcastEpisode&limit=50';
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        const eps = (data.results || [])
          .filter(e => e.wrapperType === 'podcastEpisode')
          .map(e => ({
            title: e.trackName || '(Sans titre)',
            audioUrl: e.episodeUrl || '',
            link: e.trackViewUrl || '',
            description: e.description || '',
            date: e.releaseDate || '',
            duration: e.trackTimeMillis ? Math.round(e.trackTimeMillis/1000).toString() : '',
            image: e.artworkUrl600 || e.artworkUrl160 || pod.art,
            podcastId: pod.id,
            podcastName: pod.name,
            podcastArt: pod.art
          })).filter(e => e.audioUrl);
        if (eps.length) episodes = eps;
      }
    } catch(_) {}
  }

  // Helper : parse XML text en épisodes (gère aussi la réponse JSON allorigins)
  function tryParse(text) {
    if (!text || text.length < 100) return null;
    // allorigins /get retourne { contents: "..." }
    let xml = text;
    try {
      const j = JSON.parse(text);
      if (j.contents) xml = j.contents;
    } catch(_) {}
    try {
      const data = parsePodcastFeed(xml, pod.url);
      if (!data.items?.length) return null;
      if (data.title && (!pod.name || pod.name === new URL(pod.url).hostname)) { pod.name = data.title; }
      if (data.art && !pod.art) { pod.art = data.art; }
      return data.items.map(ep => ({
        ...ep, podcastId: pod.id, podcastName: pod.name, podcastArt: ep.image || pod.art
      }));
    } catch(_) { return null; }
  }

  // Helper : fetch avec timeout
  async function ft(url, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms || 10000);
    try { const r = await fetch(url, { signal: c.signal }); clearTimeout(t); return r; }
    catch(e) { clearTimeout(t); throw e; }
  }

  // Stratégie 1 : fetch direct
  if (!episodes) {
    try {
      const r = await ft(pod.url, 8000);
      if (r.ok) episodes = tryParse(await r.text());
    } catch(_) {}
  }

  // Stratégie 2 : proxies en parallèle (tous lancés simultanément)
  if (!episodes) {
    const proxyUrls = [
      'https://api.allorigins.win/get?url=' + encodeURIComponent(pod.url),
      'https://thingproxy.freeboard.io/fetch/' + pod.url,
      'https://yacdn.org/proxy/' + pod.url,
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(pod.url),
    ];
    // Race : prendre le premier résultat valide
    episodes = await new Promise(resolve => {
      let done = false; let pending = proxyUrls.length;
      proxyUrls.forEach(async url => {
        try {
          const r = await ft(url, 12000);
          if (!done && r.ok) {
            const parsed = tryParse(await r.text());
            if (parsed && !done) { done = true; resolve(parsed); return; }
          }
        } catch(_) {}
        if (--pending === 0 && !done) resolve(null);
      });
    });
  }

  // Stratégie 3 : rss2json (fallback, limité sans clé)
  if (!episodes) {
    try {
      const url = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(pod.url) + '&count=50';
      const r = await ft(url, 10000);
      if (r.ok) {
        const data = await r.json();
        if (data.status === 'ok' && data.items?.length) {
          if (data.feed?.title && (!pod.name || pod.name === new URL(pod.url).hostname)) pod.name = data.feed.title;
          if (data.feed?.image && !pod.art) pod.art = data.feed.image;
          episodes = data.items.map(item => ({
            title: item.title || '(Sans titre)',
            audioUrl: item.enclosure?.link || item.enclosure?.url || '',
            link: item.link || '',
            description: (item.description || '').slice(0, 300),
            date: item.pubDate || '',
            duration: item.itunes_duration || '',
            image: item.thumbnail || pod.art,
            podcastId: pod.id, podcastName: pod.name, podcastArt: pod.art
          })).filter(e => e.audioUrl || e.link);
        }
      }
    } catch(_) {}
  }

  if (!episodes || !episodes.length) {
    showToast('⚠ Épisodes inaccessibles : ' + pod.name);
    return;
  }

  state.episodes = mergeEpisodes(state.episodes, episodes);
  save();
  renderPodcastView();
  showToast('✓ ' + episodes.length + ' épisodes · ' + pod.name);
}

async function addPodcast() {
  let url = document.getElementById('podUrlInput')?.value.trim();
  if (!url) { showToast('Entrez une URL de flux podcast'); return; }
  if (!url.startsWith('http')) url = 'https://' + url;
  if (state.podcasts.find(p => p.url === url)) { showToast('Podcast déjà ajouté'); return; }

  showToast('Ajout en cours…');
  // Essayer de charger pour avoir le nom/art
  let podName = new URL(url).hostname;
  let podArt = ''; let podAuthor = '';
  let text = null;

  try { const r = await fetch(url); if (r.ok) text = await r.text(); } catch(_) {}
  if (!text) { try { text = await proxyFetch(url); } catch(_) {} }

  if (text) {
    try {
      const data = parsePodcastFeed(text, url);
      podName = data.title || podName;
      podArt = data.art || '';
      podAuthor = data.author || '';
    } catch(_) {}
  }

  const pod = { id: Date.now().toString(), url, name: podName, art: podArt, author: podAuthor };
  state.podcasts.push(pod);

  if (text) {
    try {
      const data = parsePodcastFeed(text, url);
      const eps = (data.items || []).map(ep => ({ ...ep, podcastId: pod.id, podcastName: pod.name, podcastArt: pod.art }));
      state.episodes = mergeEpisodes(state.episodes, eps);
    } catch(_) {}
  }

  save();
  if (document.getElementById('podUrlInput')) document.getElementById('podUrlInput').value = '';
  renderPodcastView();
  renderPodcastSourceList();
  showToast('✓ ' + pod.name + ' ajouté');
}

function mergeEpisodes(existing, incoming) {
  const ids = new Set(existing.map(e => e.audioUrl));
  return [...incoming.filter(e => !ids.has(e.audioUrl)), ...existing]
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function refreshPodcasts() {
  if (!state.podcasts.length) return;
  await Promise.allSettled(state.podcasts.map(async pod => {
    try {
      const text = await proxyFetch(pod.url);
      const data = parsePodcastFeed(text, pod.url);
      const eps = data.items.map(ep => ({ ...ep, podcastId: pod.id, podcastName: pod.name, podcastArt: pod.art }));
      state.episodes = mergeEpisodes(state.episodes, eps);
    } catch(e) {}
  }));
  save();
  renderPodcastView();
}

function removePodcast(id) {
  state.podcasts = state.podcasts.filter(p => p.id !== id);
  state.episodes = state.episodes.filter(e => e.podcastId !== id);
  if (state.currentEpisode?.podcastId === id) closePlayer();
  save();
  renderPodcastView();
  renderPodcastSourceList();
  showToast('Podcast supprimé');
}

function switchPodTab(t) {
  podTab = t;
  document.getElementById('pod-tab-list').classList.toggle('active', t === 'list');
  document.getElementById('pod-tab-episodes').classList.toggle('active', t === 'episodes');
  document.getElementById('podcastList').style.display = t === 'list' ? '' : 'none';
  document.getElementById('episodeList').style.display = t === 'episodes' ? '' : 'none';
  if (t === 'episodes') renderEpisodeList(state.episodes);
}

function renderPodcastView() {
  const count = state.podcasts.length;
  const el = document.getElementById('podcastCountLabel');
  if (el) el.textContent = count + ' podcast' + (count > 1 ? 's' : '');
  const listEl = document.getElementById('podcastList');
  if (!listEl) return;
  if (!count) {
    listEl.innerHTML = '<div class="empty-state"><i class="ti ti-microphone empty-icon"></i><div class="empty-title">Aucun podcast</div><div class="empty-sub">Ajoutez des podcasts depuis l\'onglet Sources.</div></div>';
    return;
  }
  listEl.innerHTML = state.podcasts.map(p => {
    const epCount = state.episodes.filter(e => e.podcastId === p.id).length;
    const artHtml = p.art ? '<img src="' + p.art + '" onerror="this.style.display=\'none\'">' : '<i class="ti ti-microphone" style="font-size:22px;color:var(--text-muted)"></i>';
    return '<div class="podcast-card" data-pid="' + p.id + '">'
      + '<div class="podcast-art">' + artHtml + '</div>'
      + '<div class="podcast-info">'
      + '<div class="podcast-name">' + p.name + '</div>'
      + '<div class="podcast-meta">' + (p.author || '') + '</div>'
      + '</div>'
      + '<div class="podcast-badge">' + epCount + ' ép.</div>'
      + '</div>';
  }).join('');
}

function openPodcast(id) {
  const pod = state.podcasts.find(p => p.id === id);
  let eps = state.episodes.filter(e => e.podcastId === id);
  switchPodTab('episodes');
  if (!eps.length && pod) {
    // Pas d'épisodes — tenter de charger
    const el = document.getElementById('episodeList');
    if (el) el.innerHTML = '<div class="empty-state"><div class="spinner" style="display:inline-block;margin-bottom:8px;"></div><div class="empty-title">Chargement…</div></div>';
    loadPodcastEpisodes(pod).then(() => {
      eps = state.episodes.filter(e => e.podcastId === id);
      renderEpisodeList(eps);
    });
  } else {
    renderEpisodeList(eps);
  }
}

function renderEpisodeList(eps) {
  const el = document.getElementById('episodeList');
  if (!el) return;
  if (!eps.length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-player-play empty-icon"></i><div class="empty-title">Aucun épisode</div></div>';
    return;
  }
  el.innerHTML = eps.map((ep, i) => {
    const isPlaying = state.currentEpisode?.audioUrl === ep.audioUrl;
    const dur = formatDuration(ep.duration);
    const date = ep.date ? formatDate(ep.date) : '';
    const artHtml = ep.image ? '<img src="' + ep.image + '" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'">' : '';
    return '<div class="episode-card" data-eidx="' + i + '">' 
      + '<button class="episode-play-btn' + (isPlaying ? ' playing' : '') + '" data-eidx="' + i + '">'
      + '<i class="ti ' + (isPlaying ? 'ti-player-pause-filled' : 'ti-player-play-filled') + '"></i></button>'
      + '<div class="episode-info">'
      + '<div class="episode-title">' + ep.title + '</div>'
      + '<div class="episode-meta">'
      + (artHtml ? artHtml + ' ' : '')
      + '<span>' + ep.podcastName + '</span>'
      + (dur ? '<span>· ' + dur + '</span>' : '')
      + (date ? '<span>· ' + date + '</span>' : '')
      + '</div>'
      + '<div class="episode-desc">' + stripHtml(ep.description).slice(0, 100) + '</div>'
      + '</div></div>';
  }).join('');
  // Store eps reference for playback
  el._eps = eps;
}

function playEpisodeIdx(i, e) {
  e?.stopPropagation();
  const el = document.getElementById('episodeList');
  const eps = el?._eps || state.episodes;
  playEpisode(eps[i]);
}

function renderPodcastSourceList() {
  const el = document.getElementById('podcastSourceList');
  if (!el) return;
  if (!state.podcasts.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px"><i class="ti ti-microphone empty-icon"></i><div class="empty-title">Aucun podcast</div></div>';
    return;
  }
  el.innerHTML = state.podcasts.map(p => {
    const artHtml = p.art ? '<img src="' + p.art + '" style="width:36px;height:36px;border-radius:8px;object-fit:cover;" onerror="this.style.display=\'none\'">' : '<i class="ti ti-microphone" style="font-size:18px;color:var(--text-muted)"></i>';
    return '<div class="feed-item">'
      + '<div class="feed-icon" style="background:#6366f122;width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;">' + artHtml + '</div>'
      + '<div class="feed-info"><div class="feed-name">' + p.name + '</div><div class="feed-url">' + p.url + '</div></div>'
      + '<button class="feed-del" data-pid="' + p.id + '"><i class="ti ti-x"></i></button>'
      + '</div>';
  }).join('');
}

function setSrcTab(t) {
  srcTab = t;
  const isFlux = t === 'flux';
  document.getElementById('srcFluxPanel').style.display = isFlux ? '' : 'none';
  document.getElementById('srcPodPanel').style.display = isFlux ? 'none' : '';
  document.getElementById('src-tab-flux').style.background = isFlux ? 'var(--accent)' : 'transparent';
  document.getElementById('src-tab-flux').style.color = isFlux ? '#fff' : 'var(--text-muted)';
  document.getElementById('src-tab-pod').style.background = isFlux ? 'transparent' : 'var(--accent)';
  document.getElementById('src-tab-pod').style.color = isFlux ? 'var(--text-muted)' : '#fff';
  if (!isFlux) renderPodcastSourceList();
}

function setPodSrcTab(tab) {
  const isExplore = tab === 'explore';
  document.getElementById('pod-src-explore').classList.toggle('active', isExplore);
  document.getElementById('pod-src-mine').classList.toggle('active', !isExplore);
  document.getElementById('podExplorePanel').style.display = isExplore ? '' : 'none';
  document.getElementById('podMinePanel').style.display = isExplore ? 'none' : '';
}

function playEpisode(ep) {
  if (!ep?.audioUrl) return;
  state.currentEpisode = ep;
  audio.src = ep.audioUrl;
  audio.playbackRate = SPEEDS[speedIdx];

  // Restaurer la position si c'est le même épisode
  const saved = (() => { try { return JSON.parse(localStorage.getItem('rss_player_pos') || 'null'); } catch(_) { return null; } })();
  if (saved && saved.episodeId === ep.audioUrl && saved.position > 10) {
    audio.addEventListener('loadedmetadata', function restorePos() {
      audio.currentTime = saved.position;
      audio.removeEventListener('loadedmetadata', restorePos);
    });
    if (saved.speed) {
      const sIdx = SPEEDS.indexOf(saved.speed);
      if (sIdx >= 0) { speedIdx = sIdx; audio.playbackRate = saved.speed; }
    }
  }

  audio.play().catch(() => {});
  updatePlayerUI(ep);
  showMiniPlayer();
  renderEpisodeList(document.getElementById('episodeList')?._eps || state.episodes);

  // Media Session API : contrôles sur l'écran verrouillé iOS
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title || 'Podcast',
      artist: ep.podcastName || '',
      artwork: ep.image ? [{ src: ep.image, sizes: '512x512', type: 'image/jpeg' }] : []
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => seekRelative(-15));
    navigator.mediaSession.setActionHandler('seekforward', () => seekRelative(30));
    navigator.mediaSession.setActionHandler('stop', closePlayer);
  }
}

function updatePlayerUI(ep) {
  // Mini
  document.getElementById('miniTitle').textContent = ep.title;
  document.getElementById('miniPodcast').textContent = ep.podcastName || '';
  const miniArt = document.getElementById('miniArt');
  miniArt.innerHTML = ep.image ? '<img src="' + ep.image + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.style.display=\'none\'">' : '<i class="ti ti-microphone" style="font-size:18px;color:var(--text-muted)"></i>';
  // Full
  document.getElementById('fpTitle').textContent = ep.title;
  document.getElementById('fpPodcast').textContent = ep.podcastName || '';
  const fpArt = document.getElementById('fpArt');
  fpArt.innerHTML = ep.image ? '<img src="' + ep.image + '" style="width:100%;height:100%;object-fit:cover;border-radius:18px;" onerror="this.style.display=\'none\'">' : '<i class="ti ti-microphone" style="font-size:60px;color:var(--text-muted)"></i>';
}

function togglePlay() {
  if (!state.currentEpisode) return;
  if (audio.paused) { audio.play(); } else { audio.pause(); }
}

function seekRelative(s) {
  audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + s));
}

function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  audio.playbackRate = SPEEDS[speedIdx];
  document.getElementById('fpSpeed').textContent = SPEEDS[speedIdx] + '×';
}

function seekFromMini(e) {
  const bar = e.currentTarget;
  const pct = e.offsetX / bar.offsetWidth;
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

function seekFromFull(e) {
  const bar = document.getElementById('fpSeek');
  const pct = e.offsetX / bar.offsetWidth;
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

function showMiniPlayer() {
  document.getElementById('miniPlayer').classList.add('visible');
  requestAnimationFrame(setSwipeHeight);
  document.getElementById('bottomNav').style.marginBottom = '';
}

function closePlayer() {
  audio.pause();
  audio.src = '';
  state.currentEpisode = null;
  document.getElementById('miniPlayer').classList.remove('visible');
  requestAnimationFrame(setSwipeHeight);
  document.getElementById('fullPlayer').classList.remove('open');
}

function openFullPlayer() {
  document.getElementById('fullPlayer').classList.add('open');
}

function closeFullPlayer() {
  document.getElementById('fullPlayer').classList.remove('open');
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0')
               : m + ':' + String(sec).padStart(2,'0');
}

function formatDuration(d) {
  if (!d) return '';
  if (d.includes(':')) return d; // déjà formaté HH:MM:SS
  const s = parseInt(d);
  if (isNaN(s)) return '';
  return formatTime(s);
}


// ── Audio engine ──
const audio = document.getElementById('podcastAudio');


function playEpisode(ep) {
  if (!ep?.audioUrl) return;
  state.currentEpisode = ep;
  audio.src = ep.audioUrl;
  audio.playbackRate = SPEEDS[speedIdx];

  // Restaurer la position si c'est le même épisode
  const saved = (() => { try { return JSON.parse(localStorage.getItem('rss_player_pos') || 'null'); } catch(_) { return null; } })();
  if (saved && saved.episodeId === ep.audioUrl && saved.position > 10) {
    audio.addEventListener('loadedmetadata', function restorePos() {
      audio.currentTime = saved.position;
      audio.removeEventListener('loadedmetadata', restorePos);
    });
    if (saved.speed) {
      const sIdx = SPEEDS.indexOf(saved.speed);
      if (sIdx >= 0) { speedIdx = sIdx; audio.playbackRate = saved.speed; }
    }
  }

  audio.play().catch(() => {});
  updatePlayerUI(ep);
  showMiniPlayer();
  renderEpisodeList(document.getElementById('episodeList')?._eps || state.episodes);

  // Media Session API : contrôles sur l'écran verrouillé iOS
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title || 'Podcast',
      artist: ep.podcastName || '',
      artwork: ep.image ? [{ src: ep.image, sizes: '512x512', type: 'image/jpeg' }] : []
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => seekRelative(-15));
    navigator.mediaSession.setActionHandler('seekforward', () => seekRelative(30));
    navigator.mediaSession.setActionHandler('stop', closePlayer);
  }
}

function updatePlayerUI(ep) {
  // Mini
  document.getElementById('miniTitle').textContent = ep.title;
  document.getElementById('miniPodcast').textContent = ep.podcastName || '';
  const miniArt = document.getElementById('miniArt');
  miniArt.innerHTML = ep.image ? '<img src="' + ep.image + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.style.display=\'none\'">' : '<i class="ti ti-microphone" style="font-size:18px;color:var(--text-muted)"></i>';
  // Full
  document.getElementById('fpTitle').textContent = ep.title;
  document.getElementById('fpPodcast').textContent = ep.podcastName || '';
  const fpArt = document.getElementById('fpArt');
  fpArt.innerHTML = ep.image ? '<img src="' + ep.image + '" style="width:100%;height:100%;object-fit:cover;border-radius:18px;" onerror="this.style.display=\'none\'">' : '<i class="ti ti-microphone" style="font-size:60px;color:var(--text-muted)"></i>';
}

function togglePlay() {
  if (!state.currentEpisode) return;
  if (audio.paused) { audio.play(); } else { audio.pause(); }
}

function seekRelative(s) {
  audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + s));
}

function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  audio.playbackRate = SPEEDS[speedIdx];
  document.getElementById('fpSpeed').textContent = SPEEDS[speedIdx] + '×';
}

function seekFromMini(e) {
  const bar = e.currentTarget;
  const pct = e.offsetX / bar.offsetWidth;
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

function seekFromFull(e) {
  const bar = document.getElementById('fpSeek');
  const pct = e.offsetX / bar.offsetWidth;
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

function showMiniPlayer() {
  document.getElementById('miniPlayer').classList.add('visible');
  requestAnimationFrame(setSwipeHeight);
  document.getElementById('bottomNav').style.marginBottom = '';
}

function closePlayer() {
  audio.pause();
  audio.src = '';
  state.currentEpisode = null;
  document.getElementById('miniPlayer').classList.remove('visible');
  requestAnimationFrame(setSwipeHeight);
  document.getElementById('fullPlayer').classList.remove('open');
}

function openFullPlayer() {
  document.getElementById('fullPlayer').classList.add('open');
}

function closeFullPlayer() {
  document.getElementById('fullPlayer').classList.remove('open');
}

// Swipe down to close full player
(function() {
  let sy = 0;
  const fp = document.getElementById('fullPlayer');
  fp.addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, { passive: true });
  fp.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - sy > 80) closeFullPlayer();
  }, { passive: true });
})();

// Audio events
audio.addEventListener('play', () => {
  const icon = '<i class="ti ti-player-pause-filled"></i>';
  document.getElementById('miniPlayBtn').innerHTML = icon;
  document.getElementById('fpPlayBtn').innerHTML = icon;
});
audio.addEventListener('pause', () => {
  const icon = '<i class="ti ti-player-play-filled"></i>';
  document.getElementById('miniPlayBtn').innerHTML = icon;
  document.getElementById('fpPlayBtn').innerHTML = icon;
});
let _positionSaveTimer = null;
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('miniProgress').style.width = pct + '%';
  document.getElementById('fpSeekFill').style.width = pct + '%';
  document.getElementById('fpCurrentTime').textContent = formatTime(audio.currentTime);

  // Sauvegarder la position toutes les 10s
  const now = Date.now();
  if (!_positionSaveTimer || now - _positionSaveTimer > 10000) {
    _positionSaveTimer = now;
    if (state.currentEpisode) {
      localStorage.setItem('rss_player_pos', JSON.stringify({
        episodeId: state.currentEpisode.audioUrl,
        position: audio.currentTime,
        duration: audio.duration,
        speed: SPEEDS[speedIdx]
      }));
    }
  }
});
audio.addEventListener('loadedmetadata', () => {
  document.getElementById('fpDuration').textContent = formatTime(audio.duration);
});
audio.addEventListener('ended', () => {
  const icon = '<i class="ti ti-player-play-filled"></i>';
  document.getElementById('miniPlayBtn').innerHTML = icon;
  document.getElementById('fpPlayBtn').innerHTML = icon;
});

// ══════════════════════════════════════════════
//  6. SEARCH — Recherche flux, podcasts, science
// ══════════════════════════════════════════════

// État recherche académique
let acCurrentQuery  = '';
let acCurrentPage   = 1;
let acTotalResults  = 0;
let advancedOpen    = false;
let advOAOnly       = false;
let advPeriod       = 'all';
let advLangs        = new Set();
let selectedPodcasts = null;
let _searchTimer    = null;
let _podSearchTimer = null;
let _rssSearchTimer = null;


function setSearchMode(mode) {
  searchMode = mode;
  // Segmented control
  ['flux','podcast','academic'].forEach(m => {
    document.getElementById('seg-' + m)?.classList.toggle('active', m === mode);
  });
  // Panneau avancé : afficher les bonnes options
  updateAdvancedPanel();
  // Info contextuelle
  updateContextInfo();
  // Relancer la recherche
  const q = document.getElementById('searchViewInput')?.value.trim() || '';
  if (q) runSearch();
  else {
    document.getElementById('searchResults').innerHTML = '<div class="search-empty"><i class="ti ti-search"></i><div class="search-empty-title">Prêt à chercher</div><div class="search-empty-sub" id="searchEmptySub">' + getSearchPlaceholder() + '</div></div>';
    document.getElementById('searchCount').style.display = 'none';
  }
}

function getSearchPlaceholder() {
  if (searchMode === 'flux') return 'Cherchez dans vos ' + state.articles.length + ' articles';
  if (searchMode === 'podcast') return 'Cherchez dans vos ' + state.episodes.length + ' épisodes';
  return 'Cherchez dans 250M+ articles scientifiques (OpenAlex)';
}

function toggleSearchAdvanced() {
  advancedOpen = !advancedOpen;
  const panel = document.getElementById('searchAdvancedPanel');
  const btn = document.getElementById('searchAdvancedBtn');
  panel.style.display = advancedOpen ? '' : 'none';
  panel.style.pointerEvents = advancedOpen ? '' : 'none';
  btn.classList.toggle('active', advancedOpen);
  if (advancedOpen) updateAdvancedPanel();
}

function updateAdvancedPanel() {
  if (!advancedOpen) return;
  // Afficher le bon sous-panneau
  const ids = ['adv-flux-opts', 'adv-podcast-opts', 'adv-academic-opts'];
  const map = { flux: 'adv-flux-opts', podcast: 'adv-podcast-opts', academic: 'adv-academic-opts' };
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === map[searchMode]) ? '' : 'none';
  });
  // Remplir la liste podcasts si besoin
  if (searchMode === 'podcast') renderPodSelectorList();
}

function updateContextInfo() {
  const el = document.getElementById('searchContextInfo');
  if (!el) return;
  if (searchMode === 'flux') {
    const n = state.articles.length;
    const nf = state.feeds.length;
    const sel = state.searchSelectedFeeds;
    const selCount = sel === null ? nf : sel.size;
    el.textContent = n + ' articles · ' + selCount + '/' + nf + ' flux';
  } else if (searchMode === 'podcast') {
    el.textContent = state.episodes.length + ' épisodes · ' + state.podcasts.length + ' podcasts';
  } else {
    el.textContent = '250M+ articles · OpenAlex' + (advOAOnly ? ' · Open Access' : '') + (advPeriod !== 'all' ? ' · ' + advPeriod + ' ans' : '') + (advLangs.size > 0 ? ' · ' + [...advLangs].join('+') : '');
  }
}

function toggleFluxDropdown() {
  const btn = document.getElementById('fluxSelectorBtn');
  const dd = document.getElementById('fluxSelectorDropdown');
  const isOpen = btn.classList.toggle('open');
  dd.classList.toggle('open', isOpen);
  if (isOpen) renderFluxSelectorList();
  // Fermer si clic ailleurs
  if (isOpen) {
    setTimeout(() => {
      document.addEventListener('click', closeFluxDropdown, { once: true, capture: true });
    }, 100);
  }
}

function closeFluxDropdown(e) {
  const wrap = document.querySelector('.flux-selector-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('fluxSelectorBtn')?.classList.remove('open');
    document.getElementById('fluxSelectorDropdown')?.classList.remove('open');
  }
}

function renderFluxSelectorList() {
  const list = document.getElementById('fluxSelectorList');
  const countEl = document.getElementById('fluxSelectorCount');
  if (!list) return;

  const selected = state.searchSelectedFeeds;
  const checked = selected === null ? state.feeds.length : selected.size;
  if (countEl) countEl.textContent = checked + ' / ' + state.feeds.length + ' flux';

  if (!state.feeds.length) {
    list.innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text-muted);">Aucun flux ajouté</div>';
    return;
  }

  list.innerHTML = state.feeds.map(f => {
    const isChecked = selected === null || selected.has(f.id);
    const count = state.articles.filter(a => a.feedId === f.id).length;
    return '<div class="flux-selector-item" data-fid="' + f.id + '">'
      + '<div class="flux-check ' + (isChecked ? 'checked' : '') + '" id="fcheck-' + f.id + '"></div>'
      + '<div class="flux-selector-dot" style="background:' + f.color + '"></div>'
      + '<span class="flux-selector-name">' + f.name + '</span>'
      + '<span class="flux-selector-artcount">' + count + ' art.</span>'
      + '</div>';
  }).join('');
  list.onclick = function(e) {
    const item = e.target.closest('[data-fid]');
    if (item) toggleFluxSelection(item.dataset.fid);
  };
}

function toggleFluxSelection(feedId) {
  // Première sélection manuelle : partir de "tous cochés"
  if (state.searchSelectedFeeds === null) {
    state.searchSelectedFeeds = new Set(state.feeds.map(f => f.id));
  }
  if (state.searchSelectedFeeds.has(feedId)) {
    state.searchSelectedFeeds.delete(feedId);
    // Si on décoché tout, réinitialiser à null (tous)
    if (state.searchSelectedFeeds.size === 0) state.searchSelectedFeeds = new Set(state.feeds.map(f => f.id));
  } else {
    state.searchSelectedFeeds.add(feedId);
  }
  updateFluxSelectorLabel();
  renderFluxSelectorList();
  runSearch();
}

function toggleAllFlux() {
  if (state.searchSelectedFeeds === null || state.searchSelectedFeeds.size === state.feeds.length) {
    // Tout décocher (garder au moins 1 : on laisse vide = aucun résultat)
    state.searchSelectedFeeds = new Set();
  } else {
    // Tout cocher
    state.searchSelectedFeeds = null;
  }
  updateFluxSelectorLabel();
  renderFluxSelectorList();
  runSearch();
}

function updateFluxSelectorLabel() {
  const label = document.getElementById('fluxSelectorLabel');
  const countEl = document.getElementById('fluxSelectorCount');
  if (!label) return;
  const sel = state.searchSelectedFeeds;
  const total = state.feeds.length;
  if (sel === null || sel.size === total) {
    label.textContent = 'Tous les flux (' + total + ')';
  } else if (sel.size === 0) {
    label.textContent = 'Aucun flux sélectionné';
  } else if (sel.size === 1) {
    const f = state.feeds.find(f => sel.has(f.id));
    label.textContent = f ? f.name : '1 flux';
  } else {
    label.textContent = sel.size + ' flux sur ' + total;
  }
  if (countEl) countEl.textContent = (sel === null ? total : sel.size) + ' / ' + total + ' flux';
}

function togglePodDropdown() {
  const dd = document.getElementById('podSelectorDropdown');
  const btn = document.getElementById('podSelectorBtn');
  const isOpen = dd.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  if (isOpen) renderPodSelectorList();
}

function renderPodSelectorList() {
  const list = document.getElementById('podSelectorList');
  const countEl = document.getElementById('podSelectorCount');
  if (!list) return;
  const total = state.podcasts.length;
  const checked = selectedPodcasts === null ? total : selectedPodcasts.size;
  if (countEl) countEl.textContent = checked + ' / ' + total;
  if (!total) { list.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--text-muted);">Aucun podcast abonné</div>'; return; }
  list.innerHTML = state.podcasts.map(p => {
    const isChecked = selectedPodcasts === null || selectedPodcasts.has(p.id);
    return '<div class="flux-selector-item" data-pod-id="' + p.id + '">'
      + '<div class="flux-check ' + (isChecked ? 'checked' : '') + '" id="pcheck-' + p.id + '"></div>'
      + '<span class="flux-selector-name">' + p.name + '</span>'
      + '</div>';
  }).join('');
  list.onclick = function(e) {
    const item = e.target.closest('[data-pod-id]');
    if (!item) return;
    if (selectedPodcasts === null) selectedPodcasts = new Set(state.podcasts.map(p => p.id));
    const id = item.dataset.podId;
    if (selectedPodcasts.has(id)) selectedPodcasts.delete(id);
    else selectedPodcasts.add(id);
    if (selectedPodcasts.size === state.podcasts.length) selectedPodcasts = null;
    updatePodSelectorLabel();
    renderPodSelectorList();
    runSearch();
  };
}

function toggleAllPods() {
  selectedPodcasts = (selectedPodcasts === null || selectedPodcasts.size === state.podcasts.length)
    ? new Set() : null;
  updatePodSelectorLabel();
  renderPodSelectorList();
  runSearch();
}

function updatePodSelectorLabel() {
  const label = document.getElementById('podSelectorLabel');
  if (!label) return;
  const sel = selectedPodcasts;
  const total = state.podcasts.length;
  label.textContent = (sel === null || sel.size === total) ? 'Tous les podcasts (' + total + ')'
    : sel.size === 0 ? 'Aucun podcast'
    : sel.size + ' podcast' + (sel.size > 1 ? 's' : '') + ' sur ' + total;
}

function toggleAdvOA(btn) {
  advOAOnly = !advOAOnly;
  btn.classList.toggle('on', advOAOnly);
  updateContextInfo();
  runSearch();
}

function setAdvPeriod(p, btn) {
  advPeriod = p;
  ['all','5','10'].forEach(id => {
    document.getElementById('adv-recent-' + id)?.classList.toggle('on', id === p);
  });
  updateContextInfo();
  runSearch();
}

function toggleAdvLang(lang) {
  if (lang === 'all') {
    // Tout : vide le set (= toutes langues)
    advLangs.clear();
  } else {
    // Toggle la langue
    if (advLangs.has(lang)) advLangs.delete(lang);
    else advLangs.add(lang);
  }
  // Mettre à jour les boutons
  const allSelected = advLangs.size === 0;
  document.getElementById('adv-lang-all')?.classList.toggle('on', allSelected);
  document.getElementById('adv-lang-fr')?.classList.toggle('on', advLangs.has('fr'));
  document.getElementById('adv-lang-en')?.classList.toggle('on', advLangs.has('en'));
  updateContextInfo();
  runSearch();
}

function runSearch() {
  const q = (document.getElementById('searchViewInput')?.value || '').trim();
  state.searchQuery = q;
  document.getElementById('searchClearBtn').style.display = q ? 'flex' : 'none';
  updateContextInfo();
  if (searchMode === 'academic') {
    searchAcademic(q);
  } else {
    renderSearchResults();
  }
}

function clearSearch() {
  document.getElementById('searchViewInput').value = '';
  state.searchQuery = '';
  document.getElementById('searchClearBtn').style.display = 'none';
  renderSearchResults();
}

function toggleSP(opt) {
  if (opt === 'title') {
    state.search.inTitle = !state.search.inTitle;
    document.getElementById('sp-title').classList.toggle('on', state.search.inTitle);
  } else {
    state.search.inBody = !state.search.inBody;
    document.getElementById('sp-body').classList.toggle('on', state.search.inBody);
  }
  if (!state.search.inTitle && !state.search.inBody) {
    state.search.inTitle = true;
    document.getElementById('sp-title').classList.add('on');
  }
  renderSearchResults();
}

function setSP(p) {
  state.search.period = p;
  ['all','week','month'].forEach(id => {
    document.getElementById('sp-' + id)?.classList.toggle('on', id === p);
  });
  updateSearchInfo();
  renderSearchResults();
}

function highlight(text, q) {
  if (!text || !q) return text || '';
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark style="background:var(--accent);color:#fff;border-radius:3px;padding:0 2px;">$1</mark>');
  } catch(e) { return text; }
}

function renderSearchResults() {
  const q = state.searchQuery.toLowerCase();
  const resultsEl = document.getElementById('searchResults');
  const countEl = document.getElementById('searchCount');
  const { inTitle, inBody, period } = state.search;

  if (!q) {
    countEl.style.display = 'none';
    updateSearchInfo();
    const nb = state.articles.length;
    const info = nb ? 'Tapez des mots-clés pour chercher parmi ' + nb + ' articles' : 'Ajoutez des flux dans Sources';
    document.getElementById('searchEmptySub').textContent = info;
    return;
  }

  // Filtre période
  let since = null;
  if (period !== 'all') {
    const ms = { week: 7*86400000, month: 30*86400000 };
    since = Date.now() - ms[period];
  }

  const sel = state.searchSelectedFeeds;
  const isPod = searchMode === 'podcast';

  let results;
  if (isPod) {
    results = state.episodes.filter(ep => {
      if (selectedPodcasts !== null && !selectedPodcasts.has(ep.podcastId)) return false;
      return (ep.title || '').toLowerCase().includes(q) ||
             (ep.description || '').toLowerCase().includes(q);
    });
  } else {
    results = state.articles.filter(a => {
      if (sel !== null && !sel.has(a.feedId)) return false;
      if (since && a.date) {
        const d = new Date(a.date).getTime();
        if (!isNaN(d) && d < since) return false;
      }
      const matchTitle = inTitle && (a.title || '').toLowerCase().includes(q);
      const matchBody  = inBody  && (a.description || '').toLowerCase().includes(q);
      return matchTitle || matchBody;
    });
  }

  if (!results.length) {
    countEl.style.display = 'none';
    resultsEl.innerHTML = '<div class="search-empty"><i class="ti ti-mood-empty"></i><div class="search-empty-title">Aucun résultat</div><div class="search-empty-sub">Essayez d\'autres mots-clés ou élargissez la période.</div></div>';
    return;
  }

  countEl.style.display = 'block';
  const periodLabel = { week:' · semaine', month:' · mois', all:'' }[period] || '';
  const scopeLabel = isPod ? '' : (inTitle && inBody) ? '' : inTitle ? ' · titres' : ' · contenu';
  countEl.textContent = results.length + ' résultat' + (results.length > 1 ? 's' : '') + periodLabel + scopeLabel;
  updateSearchInfo();

  if (isPod) {
    resultsEl.innerHTML = results.slice(0, 50).map((ep, i) => {
      const dur = formatDuration(ep.duration);
      const date = ep.date ? formatDate(ep.date) : '';
      const artHtml = ep.image ? '<img src="' + ep.image + '" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;">' : '';
      return '<div class="episode-card" data-eidx="' + i + '">'
        + '<button class="episode-play-btn" data-eidx="' + i + '">'
        + '<i class="ti ti-player-play-filled"></i></button>'
        + '<div class="episode-info">'
        + '<div class="episode-title">' + highlight(ep.title, q) + '</div>'
        + '<div class="episode-meta">' + artHtml + '<span>' + ep.podcastName + '</span>'
        + (dur ? '<span>· ' + dur + '</span>' : '') + (date ? '<span>· ' + date + '</span>' : '') + '</div>'
        + '</div></div>';
    }).join('');
    // Event delegation
    resultsEl._eps = results;
    resultsEl.onclick = function(e) {
      const btn = e.target.closest('[data-eidx]');
      if (btn) { e.stopPropagation(); playEpisode(resultsEl._eps[parseInt(btn.dataset.eidx)]); }
    };
    return;
  }

  resultsEl.innerHTML = results.map((a) => {
    const isRead = state.readIds.has(a.id);
    const date = a.date ? formatDate(a.date) : '';
    const titleHl = highlight(a.title, q);
    const snippet = stripHtml(a.description || '').slice(0, 140);
    const snippetHl = highlight(snippet, q);
    const summaryHtml = snippetHl ? '<div class="card-summary">' + snippetHl + '</div>' : '';
    return '<div class="article-card ' + (isRead ? 'read' : '') + '" onclick="openSearchResult(\'' + a.id.replace(/'/g, "\\'") + '\')">'
      + '<div class="card-source">'
      + '<div class="source-dot" style="background:' + a.feedColor + '"></div>'
      + '<span class="source-name">' + a.feedName + '</span>'
      + '<span style="font-size:10px;color:var(--text-muted);margin-left:auto;">' + date + '</span>'
      + '</div>'
      + '<div class="card-title">' + titleHl + '</div>'
      + summaryHtml
      + '</div>';
  }).join('');
}

function openSearchResult(id) {
  const a = state.articles.find(x => x.id === id);
  if (!a) return;
  state.currentArticle = a;
  if (state.settings.markRead) { state.readIds.add(a.id); save(); }
  document.getElementById('readerSource').textContent = a.feedName;
  document.getElementById('readerDate').textContent = a.date ? formatDate(a.date, true) : '';
  document.getElementById('readerTitle').textContent = a.title;
  showRssContent(a);
  document.getElementById('readerView').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (a.link) loadFullArticle(a);
}

async function searchAcademic(q, page) {
  page = page || 1;
  const resultsEl = document.getElementById('searchResults');
  const countEl = document.getElementById('searchCount');
  if (!q) {
    countEl.style.display = 'none';
    resultsEl.innerHTML = '<div class="search-empty"><i class="ti ti-school"></i><div class="search-empty-title">Recherche académique</div><div class="search-empty-sub">Tapez des mots-clés pour chercher dans 250M+ articles scientifiques (OpenAlex)</div></div>';
    return;
  }

  resultsEl.innerHTML = '<div class="ac-empty"><div class="spinner" style="display:inline-block;margin-right:8px;"></div>Recherche dans OpenAlex…</div>';
  countEl.style.display = 'none';

  try {
    let apiUrl = 'https://api.openalex.org/works?search=' + encodeURIComponent(q) + '&per-page=15&sort=relevance_score:desc&mailto=app@flux-reader.fr';

    // Filtres avancés
    const filters = [];
    if (advOAOnly) filters.push('is_oa:true');
    if (advPeriod !== 'all') {
      const year = new Date().getFullYear() - parseInt(advPeriod);
      filters.push('publication_year:>' + year);
    }
    if (filters.length) apiUrl += '&filter=' + filters.join(',');

    const res = await fetch(apiUrl);
    const data = await res.json();
    const works = data.results || [];

    if (!works.length) {
      resultsEl.innerHTML = '<div class="ac-empty">Aucun résultat pour "' + q + '"</div>';
      return;
    }

    countEl.style.display = 'block';

    const savedIds = new Set(savedAcademicArticles.map(a => a.id));
    acTotalResults = data.meta?.count || works.length;
    acCurrentPage = page;
    const hasMore = (page * 15) < Math.min(acTotalResults, 200);

    const newCardsHtml = works.map((w, i) => {
      const title = w.title || '(Sans titre)';
      const authors = (w.authorships || []).slice(0,3).map(a => a.author?.display_name || '').filter(Boolean).join(', ');
      const year = w.publication_year || '';
      const journal = w.primary_location?.source?.display_name || '';
      const isOA = w.open_access?.is_oa;
      const pdfUrl = w.open_access?.oa_url || w.primary_location?.landing_page_url || '';
      const doiUrl = w.doi ? 'https://doi.org/' + w.doi.replace('https://doi.org/','') : '';
      const abstract = w.abstract_inverted_index ? reconstructAbstract(w.abstract_inverted_index).slice(0,180) : '';
      const citedBy = w.cited_by_count || 0;
      const isSaved = savedIds.has(w.id);

      return '<div class="academic-card" data-ac-idx="' + i + '">'
        + '<button class="ac-bookmark' + (isSaved ? ' saved' : '') + '" data-ac-idx="' + i + '" title="À lire plus tard">'
        + '<i class="ti ' + (isSaved ? 'ti-bookmark-filled' : 'ti-bookmark') + '"></i></button>'
        + '<div class="academic-title">' + highlight(title, q) + '</div>'
        + (authors ? '<div class="academic-authors">' + authors + (w.authorships?.length > 3 ? ' et al.' : '') + '</div>' : '')
        + '<div class="academic-meta">'
        + (year ? '<span><i class="ti ti-calendar" style="font-size:11px;"></i> ' + year + '</span>' : '')
        + (journal ? '<span><i class="ti ti-books" style="font-size:11px;"></i> ' + journal + '</span>' : '')
        + (citedBy ? '<span><i class="ti ti-quote" style="font-size:11px;"></i> ' + citedBy + '</span>' : '')
        + (isOA ? '<span class="oa-badge">Open Access</span>' : '')
        + '</div>'
        + (abstract ? '<div class="academic-abstract">' + abstract + '</div>' : '')
        + '<div class="academic-actions">'
        + (pdfUrl ? '<a class="ac-btn primary" href="' + pdfUrl + '" target="_blank"><i class="ti ti-file-text"></i> Lire</a>' : '')
        + (doiUrl ? '<a class="ac-btn" href="' + doiUrl + '" target="_blank"><i class="ti ti-external-link"></i> DOI</a>' : '')
        + '<button class="ac-btn' + (isSaved ? ' saved' : '') + '" data-ac-save="' + i + '">'
        + '<i class="ti ti-bookmark"></i> ' + (isSaved ? 'Sauvegardé' : 'À lire')
        + '</button>'
        + '</div>'
        + '</div>';
    });

    const loadMoreBtn = hasMore
      ? '<button id="ac-load-more-btn" style="width:100%;padding:14px;background:var(--surface);border:none;border-top:1px solid var(--border);color:var(--accent-hover);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;" onclick="searchAcademic(acCurrentQuery, acCurrentPage+1)">Charger 15 résultats de plus <i class="ti ti-chevron-down"></i></button>'
      : '';

    if (page === 1) {
      // Première page : remplacer tout le contenu
      resultsEl.innerHTML = '<div id="ac-cards">' + newCardsHtml.join('') + '</div>' + loadMoreBtn;
      // Event delegation sur ac-cards
      resultsEl.querySelector('#ac-cards').addEventListener('click', acClickHandler);
      // Stocker works
      resultsEl._acWorks = works;
    } else {
      // Pages suivantes : ajouter après les cartes existantes
      document.getElementById('ac-loading-more')?.remove();
      document.getElementById('ac-load-more-btn')?.remove();
      const cardsContainer = resultsEl.querySelector('#ac-cards');
      if (cardsContainer) {
        cardsContainer.insertAdjacentHTML('beforeend', newCardsHtml.join(''));
        if (!cardsContainer._hasListener) {
          cardsContainer.addEventListener('click', acClickHandler);
          cardsContainer._hasListener = true;
        }
      }
      resultsEl._acWorks = (resultsEl._acWorks || []).concat(works);
      if (loadMoreBtn) resultsEl.insertAdjacentHTML('beforeend', loadMoreBtn);
    }

  } catch(err) {
    if (page === 1) {
      resultsEl.innerHTML = '<div class="ac-empty">Erreur : ' + err.message + '<br><small>Vérifiez votre connexion</small></div>';
    } else {
      document.getElementById('ac-loading-more')?.remove();
      showToast('Erreur lors du chargement');
    }
  }
}

function acClickHandler(e) {
  const el = e.currentTarget.closest('#ac-cards') ? e.currentTarget : e.currentTarget;
  const saveBtn = e.target.closest('[data-ac-save]');
  const bookmarkBtn = e.target.closest('.ac-bookmark[data-ac-idx]');
  const btn = saveBtn || bookmarkBtn;
  if (!btn) return;
  const idx = parseInt(btn.dataset.acSave ?? btn.dataset.acIdx);
  const resultsEl = document.getElementById('searchResults');
  toggleAcademicSave((resultsEl._acWorks || [])[idx], resultsEl);
}

function reconstructAbstract(invIndex) {
  if (!invIndex) return '';
  const words = [];
  Object.entries(invIndex).forEach(([word, positions]) => {
    positions.forEach(pos => { words[pos] = word; });
  });
  return words.filter(Boolean).join(' ');
}

function toggleAcademicSave(work, resultsEl) {
  const idx = savedAcademicArticles.findIndex(a => a.id === work.id);
  if (idx >= 0) {
    savedAcademicArticles.splice(idx, 1);
    showToast('Retiré de À lire');
  } else {
    const pdfUrl = work.open_access?.oa_url || work.primary_location?.landing_page_url || '';
    savedAcademicArticles.push({
      id: work.id,
      title: work.title,
      authors: (work.authorships || []).slice(0,3).map(a => a.author?.display_name || '').filter(Boolean).join(', '),
      year: work.publication_year,
      journal: work.primary_location?.source?.display_name || '',
      url: pdfUrl || (work.doi ? 'https://doi.org/' + work.doi : ''),
      isOA: work.open_access?.is_oa,
      abstract: work.abstract_inverted_index ? reconstructAbstract(work.abstract_inverted_index).slice(0,300) : '',
      savedAt: Date.now()
    });
    showToast('✓ Ajouté à À lire');
  }
  localStorage.setItem('saved_academic', JSON.stringify(savedAcademicArticles));
  // Re-render
  if (resultsEl) {
    const q = document.getElementById('searchViewInput')?.value || '';
    searchAcademic(q);
  }
}

function renderAcademicReadList() {
  const resultsEl = document.getElementById('searchResults');
  const countEl = document.getElementById('searchCount');
  if (!savedAcademicArticles.length) {
    countEl.style.display = 'none';
    resultsEl.innerHTML = '<div class="search-empty"><i class="ti ti-bookmark"></i><div class="search-empty-title">Aucun article sauvegardé</div><div class="search-empty-sub">Ajoutez des articles depuis la recherche académique.</div></div>';
    return;
  }
  countEl.style.display = 'block';
  countEl.textContent = savedAcademicArticles.length + ' article' + (savedAcademicArticles.length > 1 ? 's' : '') + ' sauvegardé' + (savedAcademicArticles.length > 1 ? 's' : '');
  resultsEl.innerHTML = savedAcademicArticles.map((a, i) => {
    return '<div class="academic-card">'
      + '<div class="academic-title">' + a.title + '</div>'
      + (a.authors ? '<div class="academic-authors">' + a.authors + '</div>' : '')
      + '<div class="academic-meta">'
      + (a.year ? '<span>' + a.year + '</span>' : '')
      + (a.journal ? '<span>' + a.journal + '</span>' : '')
      + (a.isOA ? '<span class="oa-badge">Open Access</span>' : '')
      + '</div>'
      + (a.abstract ? '<div class="academic-abstract">' + a.abstract + '</div>' : '')
      + '<div class="academic-actions">'
      + (a.url ? '<a class="ac-btn primary" href="' + a.url + '" target="_blank"><i class="ti ti-file-text"></i> Lire</a>' : '')
      + '<button class="ac-btn" onclick="removeAcSaved(' + i + ')"><i class="ti ti-trash"></i> Retirer</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function removeAcSaved(idx) {
  savedAcademicArticles.splice(idx, 1);
  localStorage.setItem('saved_academic', JSON.stringify(savedAcademicArticles));
  renderAcademicReadList();
  showToast('Retiré de À lire');
}

function updateSearchInfo() {
  const el = document.getElementById('searchRangeText');
  if (!el) return;
  const { type, period, inTitle, inBody } = state.search;
  const isPod = type === 'podcasts';

  // Nombre d'éléments selon le type
  const n = isPod ? state.episodes.length : state.articles.length;
  const label = isPod ? 'épisode' : 'article';

  if (!n) {
    el.textContent = isPod ? 'Aucun épisode — abonnez-vous à des podcasts' : 'Aucun article — ajoutez des flux';
    return;
  }

  // Date la plus ancienne
  const items = isPod ? state.episodes : state.articles;
  let oldest = null;
  items.forEach(a => {
    if (!a.date) return;
    const d = new Date(a.date);
    if (!isNaN(d) && (!oldest || d < oldest)) oldest = d;
  });

  const fmt = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const periodLabel = { week: '1 semaine', month: '1 mois', all: 'Tout' }[period] || '';
  const scopeLabel = (inTitle && inBody) ? '' : inTitle ? ' · titres seuls' : ' · contenu seul';
  const rangeStr = oldest ? ' · depuis ' + fmt(oldest) : '';

  el.textContent = n + ' ' + label + (n > 1 ? 's' : '') + rangeStr + (periodLabel !== 'Tout' ? ' · ' + periodLabel : '') + scopeLabel;
}

// ══════════════════════════════════════════════
//  7. RENDER — Affichage et interactions UI
// ══════════════════════════════════════════════


function renderArticles() {
  const el = document.getElementById('articleList');
  const articles = getFilteredArticles();

  document.getElementById('articleCountLabel').textContent =
    articles.length + ' article' + (articles.length > 1 ? 's' : '');
  requestAnimationFrame(() => restoreScrollPos('articleList'));
  // Restaurer position de scroll après rendu
  requestAnimationFrame(() => restoreScrollPos('articleList'));

  if (!articles.length) {
    el.innerHTML = `<div class="empty-state">
      <i class="ti ${state.feeds.length ? 'ti-search' : 'ti-rss'} empty-icon"></i>
      <div class="empty-title">${state.feeds.length ? 'Aucun résultat' : 'Aucun flux ajouté'}</div>
      <div class="empty-sub">${state.feeds.length ? 'Essayez un autre filtre ou terme de recherche.' : 'Allez dans Sources pour ajouter vos premiers flux RSS.'}</div>
    </div>`;
    return;
  }

  el.innerHTML = articles.map((a, i) => {
    const isRead = state.readIds.has(a.id);
    const date = a.date ? formatDate(a.date) : '';
    const img = state.settings.showImages && a.image ? `<img class="card-img" src="${a.image}" loading="lazy" onerror="this.style.display=\'none\'">` : '';
    const summary = stripHtml(a.description).slice(0, 120);
    return `<div class="article-card ${isRead ? 'read' : ''}" onclick="openArticle(${i})">
      ${!isRead ? '<div class="unread-dot"></div>' : ''}
      <div class="card-source">
        <div class="source-dot" style="background:${a.feedColor}"></div>
        <span class="source-name">${a.feedName}</span>
      </div>
      ${img}
      <div class="card-title">${a.title}</div>
      ${summary ? `<div class="card-summary">${summary}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
        ${date ? `<div class="card-date-full" style="margin-top:0"><i class="ti ti-clock"></i> ${date}</div>` : '<div></div>'}
        <button class="save-btn ${state.savedIds.has(a.id) ? 'saved' : ''}" onclick="toggleSave(event,'${a.id}')" title="À lire plus tard">
          <i class="ti ti-bookmark" ${state.savedIds.has(a.id) ? 'style="color:var(--red);fill:var(--red);"' : ''}></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

function extractArticleContent(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Supprimer les éléments parasites
  ['script','style','nav','header','footer','aside','form',
   '.ad','[class*="advert"]','[class*="banner"]','[class*="sidebar"]',
   '[class*="related"]','[class*="comment"]','[class*="share"]',
   '[class*="social"]','[class*="newsletter"]','[id*="sidebar"]',
   '[id*="comment"]','[class*="menu"]','[class*="cookie"]'
  ].forEach(sel => { try { doc.querySelectorAll(sel).forEach(el => el.remove()); } catch(_){} });

  // Chercher le contenu dans des sélecteurs courants (du plus spécifique au plus général)
  const selectors = [
    'article .content', 'article .article-body', 'article .post-content',
    '.article-content', '.article-body', '.post-content', '.entry-content',
    '.content-body', '.story-body', '.article__content', '.article__body',
    '[itemprop="articleBody"]', '.paywall-article', '.article-text',
    'article', 'main', '.main-content', '#content', '#article'
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 200) {
      return cleanContent(el);
    }
  }

  // Fallback : paragraphes du body
  const paras = [...doc.querySelectorAll('p')]
    .filter(p => p.textContent.trim().length > 60);
  if (paras.length > 2) {
    const div = document.createElement('div');
    paras.forEach(p => div.appendChild(p.cloneNode(true)));
    return cleanContent(div);
  }

  return null;
}

function cleanContent(el) {
  // Nettoyer les images sans src, liens vides, etc.
  el.querySelectorAll('img').forEach(img => {
    if (!img.src || img.src.startsWith('data:')) img.remove();
    else { img.style.maxWidth = '100%'; img.style.height = 'auto'; img.style.borderRadius = '8px'; img.style.margin = '12px 0'; }
  });
  el.querySelectorAll('a').forEach(a => { a.style.color = 'var(--accent2)'; a.target = '_blank'; });
  el.querySelectorAll('h1,h2,h3,h4').forEach(h => { h.style.fontFamily = "'Playfair Display', serif"; h.style.color = 'var(--text)'; h.style.margin = '20px 0 8px'; });
  el.querySelectorAll('p').forEach(p => { p.style.marginBottom = '14px'; });
  el.querySelectorAll('blockquote').forEach(q => { q.style.borderLeft = '3px solid var(--accent2)'; q.style.paddingLeft = '14px'; q.style.color = 'var(--text-muted)'; q.style.margin = '16px 0'; });
  return el.innerHTML;
}

async function loadFullArticle(a) {
  const contentEl = document.getElementById('readerContent');
  if (!a.link) return;

  contentEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:20px 0"><div class="spinner"></div> Chargement…</div>';

  try {
    const html = await proxyFetch(a.link);
    const extracted = extractArticleContent(html, a.link);
    if (extracted && extracted.trim().length > 100) {
      contentEl.innerHTML = `<div class="full-article-content">${extracted}</div>`;
    } else {
      // Fallback sur le contenu RSS
      showRssContent(a);
    }
  } catch(e) {
    // Fallback sur le contenu RSS
    showRssContent(a);
  }
}

function showRssContent(a) {
  const contentEl = document.getElementById('readerContent');
  const rssContent = a.description
    ? `<p>${stripHtml(a.description).replace(/\n+/g, '</p><p>')}</p>
       <p style="color:var(--text-muted);font-size:13px;margin-top:20px;font-style:italic">
       Contenu partiel — appuyez sur "Ouvrir ↗" pour lire l'article complet.</p>`
    : '<p style="color:var(--text-muted)">Aucun contenu disponible. Ouvrez l\'article dans le navigateur.</p>';
  contentEl.innerHTML = rssContent;
}

function openArticle(idx) {
  const articles = getFilteredArticles();
  const a = articles[idx];
  if (!a) return;
  state.currentArticle = a;

  if (state.settings.markRead) {
    state.readIds.add(a.id);
    save();
  }

  document.getElementById('readerSource').textContent = a.feedName;
  document.getElementById('readerDate').textContent = a.date ? formatDate(a.date, true) : '';
  document.getElementById('readerTitle').textContent = a.title;

  // Afficher d'abord le contenu RSS immédiatement
  showRssContent(a);
  document.getElementById('readerView').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Puis charger le contenu complet en arrière-plan
  if (a.link) loadFullArticle(a);
}

function closeReader() {
  document.getElementById('readerView').classList.remove('open');
  document.body.style.overflow = '';
  renderArticles();
  updateFilterTabs();
}

function openInBrowser() {
  if (state.currentArticle?.link) window.open(state.currentArticle.link, '_blank');
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function formatDiscDate(dateStr) {
  // Toujours afficher : "lun. 16 mai · 14:32" ou "Aujourd'hui · 09:15"
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const now = new Date();
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Aujourd\'hui · ' + time;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Hier · ' + time;
    const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    return day + ' · ' + time;
  } catch(e) { return ''; }
}

function formatDate(dateStr, long = false) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    // Moins d'1h : "il y a X min"
    if (mins < 1) return 'À l\'instant';
    if (mins < 60) return 'Il y a ' + mins + ' min';
    // Aujourd'hui : "Aujourd'hui 14:32"
    if (d.toDateString() === now.toDateString()) return 'Aujourd\'hui ' + time;
    // Hier : "Hier 09:15"
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Hier ' + time;
    // Cette semaine : "lun. 14:32"
    const days = Math.floor(diff / 86400000);
    if (days < 7) {
      const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
      return dayName + ' ' + time;
    }
    // Plus ancien : "12 jan. 2024 14:32"
    const dateStr2 = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    return long ? dateStr2 + ' à ' + time : dateStr2 + ' ' + time;
  } catch(e) { return dateStr; }
}

function extractImage(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function toggleSetting(key, btn) {
  state.settings[key] = !state.settings[key];
  btn.classList.toggle('on', state.settings[key]);
  save();
}

function openSettings() { showView('settings'); }

function closeSettings() {
  document.getElementById('settingsView').classList.remove('active');
  // Revenir à la vue précédente (ou flux par défaut)
  const prev = state.currentView && state.currentView !== 'settings' ? state.currentView : 'flux';
  showView(prev);
}

function saveToFile() {
  const icon = document.getElementById('saveFileIcon');
  // Animation
  if (icon) { icon.className = 'ti ti-loader'; icon.style.animation = 'spin 0.8s linear infinite'; }

  try {
    const backup = {
      version: '3.1',
      savedAt: new Date().toISOString(),
      feeds: state.feeds,
      podcasts: state.podcasts,
      articles: state.articles.slice(0, 500), // 500 derniers articles
      episodes: state.episodes.slice(0, 200).map(ep => ({...ep, description: (ep.description||'').slice(0,300)})),
      readIds: [...state.readIds],
      savedIds: [...state.savedIds],
      settings: state.settings,
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0,10);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flux-backup-' + date + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setTimeout(() => {
      if (icon) { icon.className = 'ti ti-check'; icon.style.animation = ''; icon.style.color = '#6fcf6f'; }
      showToast('✓ Sauvegarde créée — enregistre-la dans iCloud Drive');
      setTimeout(() => {
        if (icon) { icon.className = 'ti ti-device-floppy'; icon.style.color = ''; }
      }, 2000);
    }, 300);

  } catch(e) {
    if (icon) { icon.className = 'ti ti-device-floppy'; icon.style.animation = ''; }
    showToast('Erreur lors de la sauvegarde');
  }
}

async function restoreFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.version || (!backup.feeds && !backup.podcasts)) {
      showToast('Fichier de sauvegarde invalide');
      return;
    }

    // Confirmer avant d'écraser
    const n = (backup.feeds?.length || 0) + (backup.podcasts?.length || 0);
    const msg = 'Restaurer ' + n + ' source' + (n>1?'s':'') + ' depuis le ' + (backup.savedAt ? new Date(backup.savedAt).toLocaleDateString('fr-FR') : 'fichier') + ' ?\nCela remplacera vos données actuelles.';
    if (!confirm(msg)) return;

    showToast('Restauration en cours…');

    // Restaurer tout
    if (backup.feeds) state.feeds = backup.feeds;
    if (backup.podcasts) state.podcasts = backup.podcasts;
    if (backup.articles) state.articles = backup.articles;
    if (backup.episodes) state.episodes = backup.episodes;
    if (backup.readIds) state.readIds = new Set(backup.readIds);
    if (backup.savedIds) state.savedIds = new Set(backup.savedIds);
    if (backup.settings) state.settings = { ...state.settings, ...backup.settings };

    save();
    renderArticles();
    updateFilterTabs();
    renderPodcastView();
    renderFluxPanel();

    const nFeeds = backup.feeds?.length || 0;
    const nPods = backup.podcasts?.length || 0;
    showToast('✓ Restauré — ' + nFeeds + ' flux, ' + nPods + ' podcast' + (nPods>1?'s':''));

  } catch(e) {
    showToast('Fichier invalide ou corrompu');
  }
}

function toggleLegacyExport() {
  const panel = document.getElementById('legacyExportPanel');
  const chevron = document.getElementById('legacyExportChevron');
  const isOpen = panel.style.display === 'none';
  panel.style.display = isOpen ? '' : 'none';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
}

function exportFeedsAnim(row) {
  // Animation press
  row.style.transform = 'scale(0.97)';
  setTimeout(() => { row.style.transform = ''; }, 150);
  const icon = document.getElementById('exportIcon');
  if (icon) {
    icon.style.transform = 'scale(0.8)';
    setTimeout(() => { icon.style.transform = ''; }, 150);
  }
  exportFeeds();
  // Feedback visuel check
  if (icon) {
    setTimeout(() => {
      icon.className = 'ti ti-check';
      icon.style.color = '#6fcf6f';
      setTimeout(() => {
        icon.className = 'ti ti-copy';
        icon.style.color = '';
      }, 1800);
    }, 200);
  }
}

async function importFeedsAnim(btn) {
  btn.style.transform = 'scale(0.93)';
  btn.style.opacity = '0.7';
  setTimeout(() => { btn.style.transform = ''; btn.style.opacity = ''; }, 160);
  await importFeeds();
  // Feedback visuel
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.background = '#6fcf6f';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = '';
  }, 1500);
}

function exportFeeds() {
  if (!state.feeds.length && !state.podcasts.length) { showToast('Rien à exporter'); return; }
  const data = {
    v: 2,
    feeds: state.feeds.map(f => ({ name: f.name, url: f.url, color: f.color })),
    podcasts: state.podcasts.map(p => ({ name: p.name, url: p.url, art: p.art, author: p.author })),
    exportedAt: new Date().toISOString()
  };
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => {
      showToast('✓ Code copié ! Colle-le dans Importer');
    }).catch(() => fallbackCopy(code));
  } else {
    fallbackCopy(code);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('✓ Code copié !'); }
  catch(e) { showToast('Copie manuelle : ' + text.slice(0,20) + '…'); }
  document.body.removeChild(ta);
}

async function importFeeds() {
  const raw = document.getElementById('importInput').value.trim();
  if (!raw) { showToast('Colle un code exporté'); return; }
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    const data = JSON.parse(json);
    if (!data.feeds && !data.podcasts) throw new Error('Format invalide');
    if (!data.feeds) data.feeds = [];
    let added = 0;
    showToast('Import en cours…');
    for (const f of data.feeds) {
      if (!f.url || state.feeds.find(x => x.url === f.url)) continue;
      try {
        const text = await proxyFetch(f.url);
        const feed = parseFeed(text, f.url);
        const newFeed = {
          id: Date.now().toString() + Math.random(),
          url: f.url,
          name: f.name || feed.title || new URL(f.url).hostname,
          color: f.color || FEED_COLORS[state.feeds.length % FEED_COLORS.length],
        };
        const newArticles = (feed.items || []).map(item => ({
          ...item, feedId: newFeed.id, feedName: newFeed.name, feedColor: newFeed.color,
          id: item.link || (newFeed.id + item.title),
        }));
        state.feeds.push(newFeed);
        state.articles = mergeArticles(state.articles, newArticles);
        added++;
      } catch(e) {}
    }
    save();
    renderArticles();
    updateFilterTabs();
    // Importer aussi les podcasts si présents (v2)
    let addedPods = 0;
    if (data.podcasts && Array.isArray(data.podcasts)) {
      for (const p of data.podcasts) {
        if (!p.url || state.podcasts.find(x => x.url === p.url)) continue;
        const pod = { id: Date.now().toString() + Math.random(), url: p.url, name: p.name || p.url, art: p.art || '', author: p.author || '' };
        state.podcasts.push(pod);
        addedPods++;
        loadPodcastEpisodes(pod);
      }
    }
    save();
    document.getElementById('importInput').value = '';
    const msg = [
      added > 0 ? added + ' flux' : '',
      addedPods > 0 ? addedPods + ' podcast' + (addedPods > 1 ? 's' : '') : ''
    ].filter(Boolean).join(' + ');
    showToast(msg ? '✓ Importé : ' + msg : 'Déjà à jour');
  } catch(e) {
    showToast('Code invalide');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function triggerRssAnim() {
  const svg = document.getElementById('rssAnim');
  if (!svg) return;
  svg.classList.remove('rss-play');
  void svg.offsetWidth;
  svg.classList.add('rss-play');
  setTimeout(() => svg.classList.remove('rss-play'), 1200);
  setTimeout(triggerRssAnim, 12000 + Math.random() * 10000);
}

function handleRssIconClick() {
  const svg = document.getElementById('rssAnim');
  if (!svg || svg.classList.contains('refreshing')) return;
  // Lancer la rotation pendant le refresh
  svg.classList.add('refreshing');
  refreshAll().finally(() => {
    svg.classList.remove('refreshing');
    // Déclencher aussi l'animation "apparition" après
    triggerRssAnim();
  });
}

async function loadOneSource(feed, refresh) {
  const cardId = 'disc-art-' + feed.name.replace(/\s+/g,'_');
  const el = document.getElementById(cardId);
  if (!el) return;
  if (refresh) el.innerHTML = '<div class="disc-loading"><div class="spinner"></div></div>';
  try {
    const now = new Date();
    const cutoff48h = new Date(now - 48 * 3600 * 1000);
    const text = await proxyFetch(feed.url);
    const data = parseFeed(text, feed.url);
    const items = (data.items || []).map(item => ({
      ...item, feedName: feed.name, feedIcon: feed.icon,
      _date: item.date ? new Date(item.date) : new Date(0)
    }));
    if (!items.length) { el.innerHTML = '<div class="disc-loading" style="color:var(--text-muted)">Aucun article</div>'; return; }
    const recent48 = items.filter(it => it._date >= cutoff48h);
    const pool = recent48.length ? recent48 : items.sort((a,b)=>b._date-a._date).slice(0,5);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    // Stocker globalement
    discoveryBySource[feed.name] = pick;
    if (!discoveryArticles.find(a => a.feedName === feed.name)) discoveryArticles.push(pick);
    else discoveryArticles = discoveryArticles.map(a => a.feedName === feed.name ? pick : a);
    // Trouver l'index global pour openDiscoveryArticle
    const idx = discoveryArticles.findIndex(a => a.feedName === feed.name);
    const discDate = pick.date ? formatDiscDate(pick.date) : '';
    el.innerHTML = `<div class="disc-article-body" onclick="openDiscoveryArticle(${idx})">
      <div class="disc-article-title">${pick.title}</div>
      ${discDate ? `<div class="disc-article-date"><i class="ti ti-clock" style="font-size:9px;"></i> ${discDate}</div>` : ''}
    </div>`;
  } catch(e) {
    el.innerHTML = '<div class="disc-loading" style="color:var(--text-muted)">Indisponible</div>';
  }
}

function toggleFluxSelector() { toggleFluxDropdown(); }
function togglePodSelector()  { togglePodDropdown(); }

// ══════════════════════════════════════════════
//  8. INIT — Démarrage de l'application
// ══════════════════════════════════════════════

// ── Capture erreurs JS (debug) ──
window.onerror = function(msg, src, line, col, err) {
  const info = `L${line}:${col} | ${msg}`;
  const box = document.getElementById('_errBox');
  if (box) {
    box.style.display = 'block';
    box.textContent  += info + '\n';
  }
  console.error('[JS Error]', info, err);
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  try {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    window.onerror('Promise: ' + reason, '', 0, 0, null);
  } catch(_) {}
});

// ══ PANNEAU DEBUG VISUEL (à retirer en production) ══
function initDebugPanel() {
  var panel = document.createElement('div');
  panel.id = '_debugPanel';
  panel.style.cssText = [
    'position:fixed', 'bottom:70px', 'left:0', 'right:0',
    'max-height:220px', 'overflow-y:auto',
    'background:rgba(0,0,0,0.92)', 'color:#0f0',
    'font-size:10px', 'font-family:monospace',
    'z-index:99998', 'padding:8px 10px',
    'border-top:1px solid #333',
    'display:none'
  ].join(';');
  document.body.appendChild(panel);

  // Bouton toggle
  var btn = document.createElement('button');
  btn.textContent = 'DEBUG';
  btn.style.cssText = [
    'position:fixed', 'bottom:70px', 'right:0',
    'background:#6366f1', 'color:#fff',
    'border:none', 'padding:4px 8px',
    'font-size:10px', 'z-index:99999',
    'cursor:pointer', 'border-radius:4px 0 0 4px'
  ].join(';');
  btn.onclick = function() {
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
    if (panel.style.display !== 'none') runDiagnostic();
  };
  document.body.appendChild(btn);
}

function dbLog(msg, color) {
  var panel = document.getElementById('_debugPanel');
  if (!panel) return;
  var line = document.createElement('div');
  line.style.color = color || '#0f0';
  line.style.borderBottom = '1px solid #222';
  line.style.padding = '2px 0';
  line.textContent = new Date().toLocaleTimeString() + ' | ' + msg;
  panel.insertBefore(line, panel.firstChild);
}

function runDiagnostic() {
  dbLog('── DIAGNOSTIC ──', '#ff0');

  // État des vues
  var views = ['fluxView','searchView','podcastView','feedsView'];
  views.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) { dbLog(id + ': INTROUVABLE', '#f00'); return; }
    var style = window.getComputedStyle(el);
    dbLog(id + ' display:' + style.display + ' h:' + el.offsetHeight + 'px', 
          el.offsetHeight > 0 ? '#0f0' : '#f80');
  });

  // swipeContainer
  var sc = document.getElementById('swipeContainer');
  if (sc) {
    var scs = window.getComputedStyle(sc);
    dbLog('swipeContainer top:' + sc.style.top + ' bottom:' + sc.style.bottom + ' h:' + sc.offsetHeight + 'px',
          sc.offsetHeight > 0 ? '#0f0' : '#f00');
  }

  // search-field
  var sf = document.querySelector('.search-field');
  if (sf) {
    dbLog('search-field h:' + sf.offsetHeight + 'px w:' + sf.offsetWidth + 'px display:' + window.getComputedStyle(sf).display,
          sf.offsetHeight > 0 ? '#0f0' : '#f00');
  }

  // searchView parent
  var sv = document.getElementById('searchView');
  if (sv) {
    dbLog('searchView children: ' + sv.children.length + ' h:' + sv.offsetHeight,
          sv.offsetHeight > 0 ? '#0f0' : '#f80');
    Array.from(sv.children).forEach(function(c, i) {
      dbLog('  child['+i+'] '+c.className.slice(0,20)+' h:'+c.offsetHeight+'px', '#0cf');
    });
  }

  // fixedHeader
  var fh = document.getElementById('fixedHeader');
  if (fh) dbLog('fixedHeader h:' + fh.offsetHeight + 'px', fh.offsetHeight > 0 ? '#0f0' : '#f00');

  // bottomNav
  var bn = document.getElementById('bottomNav');
  if (bn) dbLog('bottomNav h:' + bn.offsetHeight + 'px', bn.offsetHeight > 0 ? '#0f0' : '#f00');

  // Explorer panels
  var sp = document.getElementById('srcFluxPanel');
  if (sp) dbLog('srcFluxPanel display:' + window.getComputedStyle(sp).display + ' h:' + sp.offsetHeight, '#0cf');

  dbLog('state.feeds: ' + (typeof state !== 'undefined' ? state.feeds.length : 'N/A'), '#ff0');
  dbLog('searchMode: ' + (typeof searchMode !== 'undefined' ? searchMode : 'N/A'), '#ff0');
}

// Intercepter toutes les erreurs JS
(function() {
  var origError = window.onerror;
  window.onerror = function(msg, src, line, col, err) {
    dbLog('ERR L'+line+': '+msg, '#f00');
    if (origError) return origError(msg, src, line, col, err);
    return false;
  };
  window.addEventListener('unhandledrejection', function(e) {
    dbLog('PROMISE: ' + (e.reason && e.reason.message || String(e.reason)), '#f80');
  });
})();

function initSplash() {
  const splash = document.getElementById('splashScreen');
  splash.classList.add('splash-animate');

  // Pendant l'animation : charger flux + podcasts en arrière-plan
  setTimeout(() => {
    if (state.feeds.length) refreshAll();
    if (state.podcasts.length) {
      state.podcasts.forEach(pod => {
        const hasEps = state.episodes.some(e => e.podcastId === pod.id);
        if (!hasEps) loadPodcastEpisodes(pod);
      });
    }
  }, 500);

  // Disparaître après 3s — garanti
  function hideSplash() {
    try {
      splash.style.transition = 'opacity 0.4s ease';
      splash.style.opacity = '0';
      splash.style.pointerEvents = 'none';
      setTimeout(function() {
        splash.style.display = 'none';
        try { setSwipeHeight(); } catch(e) {}
      }, 450);
    } catch(e) { try { splash.style.display = 'none'; } catch(_) {} }
  }
  setTimeout(hideSplash, 2800);
  setTimeout(function() { try { splash.style.display = 'none'; } catch(_) {} }, 5000);
}

function toggleSearchAdv() {
  var panel = document.getElementById('searchAdv');
  if (!panel) return;
  var isOpen = panel.classList.toggle('open');
  panel.style.display = isOpen ? '' : 'none';
  requestAnimationFrame(setSwipeHeight);
}

// Aliases — noms utilisés dans le HTML vers fonctions JS
function addPodcastByUrl()      { addPodcast(); }
function switchSrcTab(t)        { setSrcTab(t); }
function switchPodMode(t)       { setPodSrcTab(t); }
function switchRssMode(t)       { setRssSrcTab(t); }
function seekFromBar(e)         { seekFromFull(e); }
function openArticleExternal()  { openInBrowser(); }
function importFromFile(ev)     { return importFeedFile(ev); }

// ── Démarrage ──
initSplash();
initDebugPanel();
setTimeout(function() {
  try { load(); } catch(e) { console.error('[INIT] load:', e); }
  try { showFluxList(); } catch(e) { console.error('[INIT] showFluxList:', e); }
  try { updateFilterTabs(); } catch(e) { console.error('[INIT] updateFilterTabs:', e); }
  try { showView('flux'); } catch(e) { console.error('[INIT] showView:', e); }
  // Synchroniser visuellement le segmented control sur 'flux' sans déclencher renderSearchResults
  try {
    ['flux','podcast','academic'].forEach(function(m) {
      var btn = document.getElementById('seg-' + m);
      if (btn) btn.classList.toggle('active', m === 'flux');
    });
  } catch(e) {}
  // Recalculer les hauteurs une fois le DOM stable
  setTimeout(function() {
    try { setSwipeHeight(); } catch(e) {}
  }, 100);
}, 50);

// ── Rafraîchissement au premier plan ──
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && state.feeds.length) {
    const last = parseInt(localStorage.getItem('rss_last_refresh') || '0');
    if (Date.now() - last > 10 * 60 * 1000) refreshAll();
  }
});

// ── Rechargement depuis cache navigateur ──
window.addEventListener('pageshow', function(e) {
  if (e.persisted && state.feeds.length) setTimeout(refreshAll, 500);
});

// ── Auto-reload épisodes manquants ──
setTimeout(() => {
  state.podcasts.forEach(pod => {
    if (!state.episodes.some(e => e.podcastId === pod.id)) {
      loadPodcastEpisodes(pod);
    }
  });
}, 2000);

// ── Event listeners podcast list ──
document.getElementById('podcastList').addEventListener('click', function(e) {
  const card = e.target.closest('[data-pid]');
  if (card) openPodcast(card.dataset.pid);
});

document.getElementById('episodeList').addEventListener('click', function(e) {
  const btn = e.target.closest('.episode-play-btn');
  if (btn) {
    const el = document.getElementById('episodeList');
    playEpisodeIdx(parseInt(btn.dataset.idx), e);
  }
});
