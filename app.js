(() => {
  'use strict';

  const APP_VERSION = '5.0.0';
  const STORAGE_KEY = 'oral-hygiene-pwa-v5';
  const LEGACY_HINT = /(oral|hygiene|口腔|衛生|question|quiz|暗記)/i;

  const $ = (id) => document.getElementById(id);
  const esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const toId = (value) => String(value);
  const unique = (values) => [...new Set((values || []).map(toId))];
  const safeJson = (text, fallback = null) => {
    try { return JSON.parse(text); } catch (_) { return fallback; }
  };

  function discoverBaseQuestions() {
    const candidates = [
      window.BASE_QUESTIONS,
      window.baseQuestions,
      window.QUESTIONS,
      window.questions,
      window.questionData,
      window.ORAL_HYGIENE_QUESTIONS
    ];
    // base-questions.js が top-level const/let で定義されている版にも対応
    for (const expression of ['BASE_QUESTIONS', 'baseQuestions', 'QUESTIONS', 'questions', 'ORAL_HYGIENE_QUESTIONS']) {
      try {
        const lexical = (0, eval)(`typeof ${expression} !== \"undefined\" ? ${expression} : null`);
        if (Array.isArray(lexical) && lexical.length) candidates.unshift(lexical);
      } catch (_) {}
    }
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) return candidate;
    }
    const ids = ['questionData', 'baseQuestionsData', 'questionsData'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const parsed = safeJson(el.textContent || '');
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
    return [];
  }

  function normalizeFigure(item) {
    if (!item) return null;
    if (typeof item === 'string') return { src: item, caption: '' };
    const src = item.src || item.url || item.path || item.dataUrl || '';
    if (!src) return null;
    return { src, caption: item.caption || item.alt || item.title || '' };
  }

  function normalizeQuestion(raw, index, baseMax) {
    const fallbackId = index + 1;
    const rawId = raw.id ?? raw.num ?? raw.number ?? fallbackId;
    const numericCandidate = Number(rawId);
    const id = Number.isFinite(numericCandidate) && numericCandidate > 0
      ? String(Math.trunc(numericCandidate))
      : String(rawId || fallbackId);
    const displayNumber = Number(raw.displayNumber ?? raw.number ?? raw.id);
    return {
      id,
      displayNumber: Number.isFinite(displayNumber) && displayNumber > 0
        ? Math.trunc(displayNumber)
        : (Number.isFinite(numericCandidate) && numericCandidate > 0 ? Math.trunc(numericCandidate) : baseMax + index + 1),
      category: String(raw.category || raw.unit || raw.section || raw.field || '未分類'),
      sectionNumber: raw.sectionNumber ?? raw.section ?? '',
      question: String(raw.question || raw.prompt || raw.q || ''),
      answer: String(raw.answer || raw.a || ''),
      note: String(raw.note || raw.explanation || raw.memo || ''),
      figures: (raw.figures || raw.images || raw.figure ? (raw.figures || raw.images || [raw.figure]) : [])
        .map(normalizeFigure).filter(Boolean),
      custom: Boolean(raw.custom || raw.isCustom),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null
    };
  }

  const rawBaseQuestions = discoverBaseQuestions();
  if (!rawBaseQuestions.length) {
    document.body.innerHTML = '<main class="fatal-screen"><h1>問題データを読み込めませんでした</h1><p>GitHub上の <code>index.html</code> または <code>base-questions.js</code> が残っているか確認してください。</p></main>';
    return;
  }

  const numericBaseIds = rawBaseQuestions.map(q => Number(q.id ?? q.num ?? q.number)).filter(Number.isFinite);
  const initialBaseMax = numericBaseIds.length ? Math.max(...numericBaseIds) : rawBaseQuestions.length;
  const BASE_DATA = rawBaseQuestions.map((q, i) => normalizeQuestion(q, i, initialBaseMax));
  const BASE_MAP = new Map(BASE_DATA.map(q => [q.id, q]));
  const BASE_MAX = Math.max(...BASE_DATA.map(q => q.displayNumber || 0), BASE_DATA.length);

  function defaultState() {
    return {
      version: APP_VERSION,
      reviewedIds: [],
      unknownIds: [],
      edits: {},
      customQuestions: [],
      deletedIds: [],
      currentId: BASE_DATA[0]?.id || null,
      nextCustomNumber: BASE_MAX + 1,
      settings: {
        mode: 'all',
        category: 'all',
        order: 'number',
        theme: 'system',
        search: '',
        view: 'study',
        managementMode: 'all'
      },
      updatedAt: null
    };
  }

  function mergeLegacyObject(target, obj, sourceKey = '') {
    if (!obj || typeof obj !== 'object') return false;
    const nested = obj.state && typeof obj.state === 'object' ? obj.state : obj;
    const relevantKeys = [
      'reviewedIds', 'unknownIds', 'knownIds', 'edits', 'questionEdits', 'editedQuestions',
      'customQuestions', 'userQuestions', 'deletedIds', 'deletedQuestionIds', 'settings', 'currentId'
    ];
    const score = relevantKeys.filter(k => k in nested).length + (LEGACY_HINT.test(sourceKey) ? 2 : 0);
    if (score < 2) return false;

    target.reviewedIds = unique([...(target.reviewedIds || []), ...(nested.reviewedIds || []), ...(nested.knownIds || [])]);
    target.unknownIds = unique([...(target.unknownIds || []), ...(nested.unknownIds || [])]);
    target.deletedIds = unique([...(target.deletedIds || []), ...(nested.deletedIds || nested.deletedQuestionIds || [])]);

    const edits = nested.edits || nested.questionEdits || nested.editedQuestions;
    if (edits && typeof edits === 'object' && !Array.isArray(edits)) {
      target.edits = { ...(target.edits || {}), ...edits };
    }

    const custom = nested.customQuestions || nested.userQuestions;
    if (Array.isArray(custom)) {
      const known = new Set((target.customQuestions || []).map(q => toId(q.id)));
      for (const q of custom) {
        const id = toId(q.id ?? q.num ?? q.number ?? `custom-${Date.now()}-${Math.random()}`);
        if (!known.has(id)) {
          target.customQuestions.push({ ...q, id, custom: true });
          known.add(id);
        }
      }
    }

    if (nested.currentId != null) target.currentId = toId(nested.currentId);
    if (nested.settings && typeof nested.settings === 'object') {
      target.settings = { ...target.settings, ...nested.settings };
    }
    for (const key of ['mode', 'category', 'order', 'theme', 'search', 'view', 'managementMode']) {
      if (nested[key] != null) target.settings[key] = nested[key];
    }
    if (Number.isFinite(Number(nested.nextCustomNumber))) {
      target.nextCustomNumber = Math.max(target.nextCustomNumber, Number(nested.nextCustomNumber));
    }
    return true;
  }

  function loadState() {
    const direct = safeJson(localStorage.getItem(STORAGE_KEY) || '');
    if (direct && typeof direct === 'object') return sanitizeState(direct);

    const migrated = defaultState();
    let found = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key === STORAGE_KEY) continue;
      const value = safeJson(localStorage.getItem(key) || '');
      if (mergeLegacyObject(migrated, value, key)) found = true;
    }
    const result = sanitizeState(migrated);
    if (found) {
      result.updatedAt = new Date().toISOString();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (_) {}
    }
    return result;
  }

  function sanitizeState(input) {
    const state = defaultState();
    if (!input || typeof input !== 'object') return state;
    state.reviewedIds = unique(input.reviewedIds || input.knownIds || []);
    state.unknownIds = unique(input.unknownIds || []);
    state.deletedIds = unique(input.deletedIds || input.deletedQuestionIds || []);
    state.edits = input.edits && typeof input.edits === 'object' && !Array.isArray(input.edits) ? input.edits : {};
    state.customQuestions = Array.isArray(input.customQuestions) ? input.customQuestions : [];
    state.currentId = input.currentId != null ? toId(input.currentId) : state.currentId;
    state.nextCustomNumber = Number.isFinite(Number(input.nextCustomNumber))
      ? Math.max(BASE_MAX + 1, Number(input.nextCustomNumber))
      : BASE_MAX + 1;
    state.settings = { ...state.settings, ...(input.settings || {}) };
    for (const key of ['mode', 'category', 'order', 'theme', 'search', 'view', 'managementMode']) {
      if (input[key] != null) state.settings[key] = input[key];
    }
    state.updatedAt = input.updatedAt || null;
    state.version = APP_VERSION;
    return state;
  }

  let state = loadState();
  let answerVisible = false;
  let figuresVisible = false;
  let filteredQuestions = [];
  let currentIndex = 0;
  let deferredInstallPrompt = null;
  let toastTimer = null;

  function persist(message = '') {
    state.updatedAt = new Date().toISOString();
    state.version = APP_VERSION;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateSavedAt();
      if (message) toast(message);
    } catch (error) {
      toast('保存容量が不足しました。添付画像を減らすか、バックアップを書き出してください。', 3500);
    }
  }

  function getAllQuestions({ includeDeleted = false } = {}) {
    const editedBase = BASE_DATA.map(base => {
      const edit = state.edits[base.id] || {};
      return {
        ...base,
        ...edit,
        id: base.id,
        displayNumber: base.displayNumber,
        custom: false,
        edited: Boolean(state.edits[base.id]),
        deleted: state.deletedIds.includes(base.id),
        figures: Array.isArray(edit.figures) ? edit.figures.map(normalizeFigure).filter(Boolean) : base.figures
      };
    });

    const customs = state.customQuestions.map((raw, i) => {
      const q = normalizeQuestion({ ...raw, custom: true }, i, BASE_MAX);
      if (!Number.isFinite(Number(raw.displayNumber))) q.displayNumber = BASE_MAX + i + 1;
      return {
        ...q,
        id: toId(raw.id ?? q.id),
        displayNumber: Number(raw.displayNumber ?? q.displayNumber),
        custom: true,
        edited: true,
        deleted: state.deletedIds.includes(toId(raw.id ?? q.id))
      };
    });

    const all = [...editedBase, ...customs];
    return includeDeleted ? all : all.filter(q => !q.deleted);
  }

  function getQuestionById(id, includeDeleted = false) {
    return getAllQuestions({ includeDeleted }).find(q => q.id === toId(id)) || null;
  }

  function currentQuestion() {
    if (!filteredQuestions.length) return null;
    return filteredQuestions[currentIndex] || filteredQuestions[0] || null;
  }

  function rebuildShell() {
    document.documentElement.lang = 'ja';
    document.title = '口腔衛生学 暗記アプリ';
    document.body.innerHTML = `
      <main class="app-shell" id="appShell">
        <header class="top-header">
          <div>
            <p class="eyebrow">口腔衛生学</p>
            <h1>一問一答 暗記アプリ</h1>
            <p class="subtitle">問題編集・削除・復元、一覧表示、図表開閉、番号移動に対応</p>
          </div>
          <div class="header-actions">
            <span id="savedAt" class="saved-pill">保存確認中</span>
            <button id="installButton" class="small-button" type="button" hidden>アプリを追加</button>
          </div>
        </header>

        <section class="stats" aria-label="学習状況">
          <div class="stat"><strong id="totalCount">0</strong><span>有効な問題</span></div>
          <div class="stat"><strong id="reviewedCount">0</strong><span>学習済み</span></div>
          <div class="stat"><strong id="unknownCount">0</strong><span>分からない</span></div>
          <div class="stat"><strong id="editedCount">0</strong><span>編集・追加</span></div>
        </section>

        <section class="toolbar" aria-label="表示設定">
          <div class="view-tabs" role="tablist" aria-label="表示方法">
            <button class="view-tab" data-view="study" type="button">学習</button>
            <button class="view-tab" data-view="list" type="button">問題一覧</button>
            <button class="view-tab" data-view="manage" type="button">問題管理</button>
          </div>
          <div class="toolbar-grid">
            <label class="control">表示する問題
              <select id="mode">
                <option value="all">すべての問題</option>
                <option value="unlearned">未学習だけ</option>
                <option value="unknown">分からなかった問題だけ</option>
                <option value="known">わかった問題だけ</option>
              </select>
            </label>
            <label class="control">単元
              <select id="category"><option value="all">すべての単元</option></select>
            </label>
            <label class="control">並び順
              <select id="order">
                <option value="number">番号順</option>
                <option value="shuffle">シャッフル</option>
              </select>
            </label>
            <label class="control">表示テーマ
              <select id="theme">
                <option value="system">端末に合わせる</option>
                <option value="light">ライト</option>
                <option value="dark">ダーク</option>
              </select>
            </label>
          </div>
          <div class="search-row">
            <input id="search" class="search-input" type="search" placeholder="問題・解答・単元を検索" autocomplete="off">
            <button id="clearSearch" class="secondary-button" type="button">検索解除</button>
            <button id="reshuffle" class="secondary-button" type="button">再シャッフル</button>
            <button id="addQuestionButton" class="accent-button" type="button">＋ 問題を追加</button>
          </div>
          <div class="progress-track" aria-hidden="true"><div class="progress-bar" id="progressBar"></div></div>
          <div class="progress-label"><span id="progressLabel">学習済み 0%</span><span id="filterCount">0問を表示</span></div>
        </section>

        <section id="studyView" class="view-panel">
          <article class="study-card" id="studyCard">
            <div class="card-top-row">
              <div id="badges" class="badges"></div>
              <div id="questionNumber" class="question-number"></div>
            </div>
            <h2 id="questionText" class="question-text"></h2>
            <div id="noteBox" class="note-box" hidden></div>

            <section id="figureSection" class="figure-section" hidden>
              <button id="toggleFigures" class="figure-toggle" type="button" aria-expanded="false">図・表を表示</button>
              <div id="figureList" class="figure-list" hidden></div>
            </section>

            <div class="card-actions compact-actions">
              <button id="editQuestionButton" type="button">編集</button>
              <button id="duplicateQuestionButton" type="button">複製</button>
              <button id="deleteQuestionButton" class="danger-button" type="button">削除</button>
            </div>

            <div id="revealWrap" class="reveal-wrap">
              <button id="revealButton" class="primary-button" type="button">解答を見る</button>
            </div>
            <div id="answerArea" class="answer-area" hidden>
              <section class="answer-block"><h3>解答</h3><p id="answerText"></p></section>
              <div class="judgement">
                <button id="knownButton" class="judge known" type="button">✓ わかった</button>
                <button id="unknownButton" class="judge unknown" type="button">！分からなかった</button>
              </div>
            </div>
          </article>
          <section id="emptyCard" class="empty-card" hidden>
            <h2>条件に合う問題がありません</h2>
            <p>絞り込み条件を変更してください。</p>
            <button id="showAllButton" class="primary-button" type="button">すべての問題に戻る</button>
          </section>
        </section>

        <section id="listView" class="view-panel" hidden>
          <div class="list-header">
            <div><h2>問題一覧</h2><p>問題をタップすると、その場で解答が開きます。</p></div>
            <button id="collapseAllAnswers" class="secondary-button" type="button">解答をすべて閉じる</button>
          </div>
          <div id="questionList" class="question-list"></div>
        </section>

        <section id="manageView" class="view-panel" hidden>
          <div class="list-header">
            <div><h2>問題管理</h2><p>編集・追加した問題や削除済み問題を管理できます。</p></div>
            <label class="control compact-control">表示
              <select id="managementMode">
                <option value="all">すべて</option>
                <option value="edited">編集済み</option>
                <option value="custom">追加問題</option>
                <option value="deleted">削除済み</option>
              </select>
            </label>
          </div>
          <div id="managementList" class="management-list"></div>
        </section>

        <details class="utility">
          <summary>保存・バックアップ・初期化</summary>
          <div class="utility-body">
            <p>学習記録、問題の編集、追加・削除はこの端末に自動保存されます。</p>
            <div class="utility-buttons">
              <button id="exportButton" type="button">全データを書き出す</button>
              <label class="file-label">全データを読み込む<input id="importFile" type="file" accept="application/json,.json"></label>
              <button id="resetUnknownButton" class="danger-button" type="button">「分からない」だけ消す</button>
              <button id="resetEditsButton" class="danger-button" type="button">編集・追加・削除を初期化</button>
              <button id="resetAllButton" class="danger-button" type="button">すべて初期化</button>
            </div>
          </div>
        </details>

        <footer>口腔衛生学 PWA v${APP_VERSION}</footer>
      </main>

      <nav id="bottomNav" class="bottom-nav" aria-label="問題移動">
        <button id="prevButton" type="button">← 前へ</button>
        <div class="jump-box">
          <label for="jumpInput">問</label>
          <input id="jumpInput" type="number" min="1" inputmode="numeric" placeholder="番号">
          <button id="jumpButton" type="button">移動</button>
        </div>
        <button id="nextButton" type="button">次へ →</button>
      </nav>

      <dialog id="editorDialog" class="editor-dialog">
        <form id="editorForm" method="dialog">
          <div class="dialog-header">
            <div><p class="eyebrow">問題編集</p><h2 id="editorTitle">問題を編集</h2></div>
            <button id="closeEditorButton" class="icon-button" type="button" aria-label="閉じる">×</button>
          </div>
          <input id="editorId" type="hidden">
          <label>単元<input id="editorCategory" required></label>
          <label>問題文<textarea id="editorQuestion" rows="5" required></textarea></label>
          <label>解答<textarea id="editorAnswer" rows="4" required></textarea></label>
          <label>補足メモ<textarea id="editorNote" rows="3"></textarea></label>
          <section class="editor-figures">
            <div class="section-title-row"><h3>図・表</h3><span>既存画像の削除や端末画像の追加ができます</span></div>
            <div id="editorFigureList" class="editor-figure-list"></div>
            <label class="file-label wide">画像を追加<input id="editorFigureInput" type="file" accept="image/*" multiple></label>
            <label>画像パスを追加（1行につき1つ）<textarea id="editorFigurePaths" rows="3" placeholder="assets/figures/figure-01.jpg"></textarea></label>
          </section>
          <div class="dialog-actions">
            <button id="resetOriginalButton" class="secondary-button" type="button">元に戻す</button>
            <button id="saveQuestionButton" class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </dialog>

      <dialog id="imageDialog" class="image-dialog">
        <button id="closeImageDialog" class="dialog-close" type="button" aria-label="閉じる">×</button>
        <img id="dialogImage" alt="拡大した図表">
        <p id="dialogCaption"></p>
      </dialog>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
    `;
  }

  rebuildShell();

  function applyTheme() {
    const theme = state.settings.theme || 'system';
    document.documentElement.dataset.theme = theme;
    $('theme').value = theme;
  }

  function updateSavedAt() {
    const el = $('savedAt');
    if (!el) return;
    if (!state.updatedAt) {
      el.textContent = 'この端末に自動保存';
      return;
    }
    const date = new Date(state.updatedAt);
    el.textContent = Number.isNaN(date.getTime()) ? '保存済み' : `${date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 保存`;
  }

  function statusOf(id) {
    const sid = toId(id);
    if (state.unknownIds.includes(sid)) return 'unknown';
    if (state.reviewedIds.includes(sid)) return 'known';
    return 'unlearned';
  }

  function populateCategories() {
    const current = state.settings.category || 'all';
    const categories = [...new Set(getAllQuestions().map(q => q.category))].sort((a, b) => a.localeCompare(b, 'ja'));
    $('category').innerHTML = '<option value="all">すべての単元</option>' + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('category').value = categories.includes(current) ? current : 'all';
    state.settings.category = $('category').value;
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function buildFilteredQuestions({ keepCurrent = true, reshuffle = false } = {}) {
    const previousId = keepCurrent ? (currentQuestion()?.id || state.currentId) : null;
    const mode = state.settings.mode || 'all';
    const category = state.settings.category || 'all';
    const query = (state.settings.search || '').trim().toLowerCase();
    let items = getAllQuestions();

    items = items.filter(q => {
      const status = statusOf(q.id);
      if (mode === 'unlearned' && status !== 'unlearned') return false;
      if (mode === 'unknown' && status !== 'unknown') return false;
      if (mode === 'known' && status !== 'known') return false;
      if (category !== 'all' && q.category !== category) return false;
      if (query) {
        const haystack = `${q.displayNumber} ${q.category} ${q.question} ${q.answer} ${q.note}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    if (state.settings.order === 'shuffle') {
      if (reshuffle || !filteredQuestions.length) items = shuffle(items);
      else {
        const priorOrder = new Map(filteredQuestions.map((q, i) => [q.id, i]));
        items.sort((a, b) => (priorOrder.get(a.id) ?? 999999) - (priorOrder.get(b.id) ?? 999999));
      }
    } else {
      items.sort((a, b) => a.displayNumber - b.displayNumber || a.question.localeCompare(b.question, 'ja'));
    }

    filteredQuestions = items;
    const foundIndex = previousId ? filteredQuestions.findIndex(q => q.id === toId(previousId)) : -1;
    currentIndex = foundIndex >= 0 ? foundIndex : 0;
    if (filteredQuestions.length) state.currentId = filteredQuestions[currentIndex].id;
    renderAllViews();
  }

  function updateStats() {
    const all = getAllQuestions();
    const activeIds = new Set(all.map(q => q.id));
    const reviewed = state.reviewedIds.filter(id => activeIds.has(id)).length;
    const unknown = state.unknownIds.filter(id => activeIds.has(id)).length;
    const edited = all.filter(q => q.edited || q.custom).length;
    $('totalCount').textContent = all.length;
    $('reviewedCount').textContent = reviewed;
    $('unknownCount').textContent = unknown;
    $('editedCount').textContent = edited;
    const percent = all.length ? Math.round(reviewed / all.length * 100) : 0;
    $('progressBar').style.width = `${percent}%`;
    $('progressLabel').textContent = `学習済み ${percent}%`;
    $('filterCount').textContent = `${filteredQuestions.length}問を表示`;
  }

  function setView(view, { persistChange = true } = {}) {
    const valid = ['study', 'list', 'manage'].includes(view) ? view : 'study';
    state.settings.view = valid;
    document.querySelectorAll('.view-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.view === valid));
    $('studyView').hidden = valid !== 'study';
    $('listView').hidden = valid !== 'list';
    $('manageView').hidden = valid !== 'manage';
    $('bottomNav').hidden = valid !== 'study';
    if (valid === 'list') renderQuestionList();
    if (valid === 'manage') renderManagementList();
    if (persistChange) persist();
  }

  function closeAnswerAndFigures() {
    answerVisible = false;
    figuresVisible = false;
  }

  function renderStudy() {
    const q = currentQuestion();
    const empty = !q;
    $('studyCard').hidden = empty;
    $('emptyCard').hidden = !empty;
    if (empty) return;

    state.currentId = q.id;
    const status = statusOf(q.id);
    const badges = [
      `<span class="badge category">${esc(q.category)}</span>`,
      status === 'known' ? '<span class="badge known">わかった</span>' : '',
      status === 'unknown' ? '<span class="badge unknown">分からない</span>' : '',
      q.edited && !q.custom ? '<span class="badge edited">編集済み</span>' : '',
      q.custom ? '<span class="badge custom">追加問題</span>' : ''
    ].filter(Boolean).join('');
    $('badges').innerHTML = badges;
    $('questionNumber').textContent = `問${q.displayNumber}　${currentIndex + 1} / ${filteredQuestions.length}`;
    $('questionText').textContent = q.question;
    $('answerText').textContent = q.answer;
    $('answerArea').hidden = !answerVisible;
    $('revealWrap').hidden = answerVisible;
    $('noteBox').hidden = !q.note;
    $('noteBox').textContent = q.note;

    renderFigures(q);
    $('prevButton').disabled = currentIndex <= 0;
    $('nextButton').disabled = currentIndex >= filteredQuestions.length - 1;
    $('jumpInput').max = Math.max(...getAllQuestions().map(item => item.displayNumber), BASE_MAX);
    $('deleteQuestionButton').textContent = '削除';
  }

  function renderFigures(q) {
    const figures = Array.isArray(q.figures) ? q.figures.filter(f => f?.src) : [];
    $('figureSection').hidden = figures.length === 0;
    $('figureList').hidden = !figuresVisible;
    $('toggleFigures').textContent = figuresVisible ? '図・表を閉じる' : `図・表を表示${figures.length > 1 ? `（${figures.length}枚）` : ''}`;
    $('toggleFigures').setAttribute('aria-expanded', figuresVisible ? 'true' : 'false');
    $('figureList').innerHTML = figures.map((figure, index) => `
      <figure class="figure-card">
        <button class="image-open" type="button" data-src="${esc(figure.src)}" data-caption="${esc(figure.caption || `図表${index + 1}`)}">
          <img src="${esc(figure.src)}" alt="${esc(figure.caption || `図表${index + 1}`)}" loading="lazy">
        </button>
        ${figure.caption ? `<figcaption>${esc(figure.caption)}</figcaption>` : ''}
        <p class="image-error" hidden>画像を読み込めません：${esc(figure.src)}</p>
      </figure>
    `).join('');
    $('figureList').querySelectorAll('img').forEach(img => {
      img.addEventListener('error', () => {
        img.hidden = true;
        img.closest('.figure-card')?.querySelector('.image-error')?.removeAttribute('hidden');
      });
    });
    $('figureList').querySelectorAll('.image-open').forEach(btn => {
      btn.addEventListener('click', () => openImage(btn.dataset.src, btn.dataset.caption));
    });
  }

  function renderQuestionList() {
    if (!$('questionList')) return;
    if (!filteredQuestions.length) {
      $('questionList').innerHTML = '<div class="empty-card"><h3>条件に合う問題がありません</h3></div>';
      return;
    }
    $('questionList').innerHTML = filteredQuestions.map(q => {
      const status = statusOf(q.id);
      const statusText = status === 'known' ? 'わかった' : status === 'unknown' ? '分からない' : '未学習';
      return `
        <details class="list-question" data-id="${esc(q.id)}">
          <summary>
            <span class="list-number">問${q.displayNumber}</span>
            <span class="list-main"><strong>${esc(q.question)}</strong><small>${esc(q.category)}</small></span>
            <span class="status-chip ${status}">${statusText}</span>
          </summary>
          <div class="list-answer">
            <h3>解答</h3>
            <p>${esc(q.answer)}</p>
            ${q.note ? `<div class="list-note">${esc(q.note)}</div>` : ''}
            <div class="inline-actions">
              <button type="button" data-action="open" data-id="${esc(q.id)}">この問題を学習画面で開く</button>
              <button type="button" data-action="edit" data-id="${esc(q.id)}">編集</button>
              <button type="button" data-action="delete" data-id="${esc(q.id)}" class="danger-button">削除</button>
            </div>
          </div>
        </details>
      `;
    }).join('');
    $('questionList').querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = btn.dataset.id;
        if (btn.dataset.action === 'open') openQuestionById(id);
        if (btn.dataset.action === 'edit') openEditor(id);
        if (btn.dataset.action === 'delete') deleteQuestion(id);
      });
    });
  }

  function renderManagementList() {
    if (!$('managementList')) return;
    const mode = state.settings.managementMode || 'all';
    let items = getAllQuestions({ includeDeleted: true });
    if (mode === 'edited') items = items.filter(q => q.edited && !q.custom && !q.deleted);
    if (mode === 'custom') items = items.filter(q => q.custom && !q.deleted);
    if (mode === 'deleted') items = items.filter(q => q.deleted);
    items.sort((a, b) => a.displayNumber - b.displayNumber);
    if (!items.length) {
      $('managementList').innerHTML = '<div class="empty-card"><h3>該当する問題はありません</h3></div>';
      return;
    }
    $('managementList').innerHTML = items.map(q => `
      <article class="management-item">
        <div class="management-main">
          <div class="management-meta">
            <span>問${q.displayNumber}</span>
            <span>${esc(q.category)}</span>
            ${q.custom ? '<span class="badge custom">追加</span>' : ''}
            ${q.edited && !q.custom ? '<span class="badge edited">編集済み</span>' : ''}
            ${q.deleted ? '<span class="badge deleted">削除済み</span>' : ''}
          </div>
          <strong>${esc(q.question)}</strong>
          <p>${esc(q.answer)}</p>
        </div>
        <div class="management-actions">
          ${q.deleted
            ? `<button type="button" data-action="restore" data-id="${esc(q.id)}">復元</button>${q.custom ? `<button type="button" class="danger-button" data-action="permanent" data-id="${esc(q.id)}">完全削除</button>` : ''}`
            : `<button type="button" data-action="open" data-id="${esc(q.id)}">開く</button><button type="button" data-action="edit" data-id="${esc(q.id)}">編集</button>${q.edited && !q.custom ? `<button type="button" data-action="reset" data-id="${esc(q.id)}">元に戻す</button>` : ''}<button type="button" class="danger-button" data-action="delete" data-id="${esc(q.id)}">削除</button>`}
        </div>
      </article>
    `).join('');
    $('managementList').querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'open') openQuestionById(id);
        if (action === 'edit') openEditor(id);
        if (action === 'delete') deleteQuestion(id);
        if (action === 'restore') restoreQuestion(id);
        if (action === 'reset') resetQuestionToOriginal(id);
        if (action === 'permanent') permanentlyDeleteCustom(id);
      });
    });
  }

  function renderAllViews() {
    updateStats();
    renderStudy();
    if (state.settings.view === 'list') renderQuestionList();
    if (state.settings.view === 'manage') renderManagementList();
    setView(state.settings.view || 'study', { persistChange: false });
  }

  function move(delta) {
    if (!filteredQuestions.length) return;
    const next = currentIndex + delta;
    if (next < 0 || next >= filteredQuestions.length) return;
    currentIndex = next;
    state.currentId = filteredQuestions[currentIndex].id;
    closeAnswerAndFigures();
    renderStudy();
    persist();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function revealAnswer() {
    answerVisible = true;
    renderStudy();
  }

  function mark(unknown) {
    const q = currentQuestion();
    if (!q) return;
    const id = q.id;
    if (!state.reviewedIds.includes(id)) state.reviewedIds.push(id);
    if (unknown) {
      if (!state.unknownIds.includes(id)) state.unknownIds.push(id);
    } else {
      state.unknownIds = state.unknownIds.filter(x => x !== id);
    }
    persist(unknown ? '「分からない」に登録しました' : '「わかった」に登録しました');
    buildFilteredQuestions({ keepCurrent: true });
  }

  function jumpToNumber() {
    const number = Number($('jumpInput').value);
    if (!Number.isInteger(number) || number < 1) {
      toast('問題番号を入力してください');
      return;
    }
    const target = getAllQuestions().find(q => q.displayNumber === number);
    if (!target) {
      toast(`問${number}は見つかりません`);
      return;
    }
    openQuestionById(target.id);
    $('jumpInput').value = '';
  }

  function openQuestionById(id) {
    const target = getQuestionById(id);
    if (!target) return;
    let index = filteredQuestions.findIndex(q => q.id === target.id);
    if (index < 0) {
      state.settings.mode = 'all';
      state.settings.category = 'all';
      state.settings.search = '';
      state.settings.order = 'number';
      syncControls();
      buildFilteredQuestions({ keepCurrent: false });
      index = filteredQuestions.findIndex(q => q.id === target.id);
      toast('絞り込みを解除して移動しました');
    }
    if (index >= 0) {
      currentIndex = index;
      state.currentId = target.id;
      closeAnswerAndFigures();
      setView('study');
      renderStudy();
      persist();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function nextCustomNumber() {
    const used = new Set(getAllQuestions({ includeDeleted: true }).map(q => q.displayNumber));
    let number = Math.max(BASE_MAX + 1, Number(state.nextCustomNumber) || BASE_MAX + 1);
    while (used.has(number)) number++;
    state.nextCustomNumber = number + 1;
    return number;
  }

  let editorFigures = [];
  let editingId = null;
  let editorMode = 'edit';

  function openEditor(id = null, duplicate = false) {
    const source = id != null ? getQuestionById(id, true) : null;
    editorMode = source ? (duplicate ? 'duplicate' : 'edit') : 'new';
    editingId = source && !duplicate ? source.id : null;
    $('editorTitle').textContent = editorMode === 'new' ? '問題を追加' : editorMode === 'duplicate' ? '問題を複製' : `問${source.displayNumber}を編集`;
    $('editorId').value = editingId || '';
    $('editorCategory').value = source?.category || (state.settings.category !== 'all' ? state.settings.category : '未分類');
    $('editorQuestion').value = source?.question || '';
    $('editorAnswer').value = source?.answer || '';
    $('editorNote').value = source?.note || '';
    $('editorFigurePaths').value = '';
    editorFigures = (source?.figures || []).map(f => ({ ...f }));
    $('resetOriginalButton').hidden = !(source && !duplicate && BASE_MAP.has(source.id));
    renderEditorFigures();
    $('editorDialog').showModal();
  }

  function renderEditorFigures() {
    $('editorFigureList').innerHTML = editorFigures.length ? editorFigures.map((f, i) => `
      <div class="editor-figure-item">
        <img src="${esc(f.src)}" alt="${esc(f.caption || `図表${i + 1}`)}">
        <div><input data-caption-index="${i}" value="${esc(f.caption || '')}" placeholder="図表の説明"><small>${esc(f.src.startsWith('data:') ? '端末から追加した画像' : f.src)}</small></div>
        <button type="button" class="danger-button" data-remove-figure="${i}">削除</button>
      </div>
    `).join('') : '<p class="muted">図表はありません。</p>';
    $('editorFigureList').querySelectorAll('[data-remove-figure]').forEach(btn => {
      btn.addEventListener('click', () => {
        editorFigures.splice(Number(btn.dataset.removeFigure), 1);
        renderEditorFigures();
      });
    });
    $('editorFigureList').querySelectorAll('[data-caption-index]').forEach(input => {
      input.addEventListener('input', () => {
        editorFigures[Number(input.dataset.captionIndex)].caption = input.value;
      });
    });
  }

  async function addEditorImageFiles(files) {
    const selected = [...(files || [])];
    for (const file of selected) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      editorFigures.push({ src: dataUrl, caption: file.name });
    }
    renderEditorFigures();
    $('editorFigureInput').value = '';
  }

  function saveEditor(event) {
    event.preventDefault();
    const category = $('editorCategory').value.trim() || '未分類';
    const question = $('editorQuestion').value.trim();
    const answer = $('editorAnswer').value.trim();
    const note = $('editorNote').value.trim();
    if (!question || !answer) {
      toast('問題文と解答を入力してください');
      return;
    }
    const pathFigures = $('editorFigurePaths').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(src => ({ src, caption: '' }));
    const figures = [...editorFigures, ...pathFigures].map(normalizeFigure).filter(Boolean);

    if (editorMode === 'edit' && editingId) {
      if (BASE_MAP.has(editingId)) {
        state.edits[editingId] = { category, question, answer, note, figures, updatedAt: new Date().toISOString() };
      } else {
        const index = state.customQuestions.findIndex(q => toId(q.id) === editingId);
        if (index >= 0) state.customQuestions[index] = { ...state.customQuestions[index], category, question, answer, note, figures, updatedAt: new Date().toISOString() };
      }
      toast('問題を更新しました');
    } else {
      const displayNumber = nextCustomNumber();
      const id = `custom-${displayNumber}-${Date.now()}`;
      state.customQuestions.push({ id, displayNumber, category, question, answer, note, figures, custom: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      state.currentId = id;
      toast(`問${displayNumber}として追加しました`);
    }
    $('editorDialog').close();
    populateCategories();
    buildFilteredQuestions({ keepCurrent: true });
    persist();
  }

  function resetQuestionToOriginal(id) {
    const sid = toId(id);
    if (!BASE_MAP.has(sid) || !state.edits[sid]) return;
    if (!confirm('この問題の編集内容を元の状態に戻しますか？')) return;
    delete state.edits[sid];
    persist('元の問題に戻しました');
    populateCategories();
    buildFilteredQuestions({ keepCurrent: true });
    if ($('editorDialog').open) $('editorDialog').close();
  }

  function deleteQuestion(id) {
    const q = getQuestionById(id, true);
    if (!q || q.deleted) return;
    if (!confirm(`問${q.displayNumber}を削除しますか？\n問題管理から復元できます。`)) return;
    if (!state.deletedIds.includes(q.id)) state.deletedIds.push(q.id);
    state.reviewedIds = state.reviewedIds.filter(x => x !== q.id);
    state.unknownIds = state.unknownIds.filter(x => x !== q.id);
    persist('問題を削除しました');
    populateCategories();
    buildFilteredQuestions({ keepCurrent: false });
  }

  function restoreQuestion(id) {
    const sid = toId(id);
    state.deletedIds = state.deletedIds.filter(x => x !== sid);
    persist('問題を復元しました');
    populateCategories();
    buildFilteredQuestions({ keepCurrent: true });
  }

  function permanentlyDeleteCustom(id) {
    const sid = toId(id);
    const q = getQuestionById(sid, true);
    if (!q?.custom) return;
    if (!confirm(`問${q.displayNumber}を完全に削除しますか？\nこの操作は元に戻せません。`)) return;
    state.customQuestions = state.customQuestions.filter(item => toId(item.id) !== sid);
    state.deletedIds = state.deletedIds.filter(x => x !== sid);
    state.reviewedIds = state.reviewedIds.filter(x => x !== sid);
    state.unknownIds = state.unknownIds.filter(x => x !== sid);
    persist('追加問題を完全に削除しました');
    buildFilteredQuestions({ keepCurrent: true });
  }

  function openImage(src, caption = '') {
    $('dialogImage').src = src;
    $('dialogCaption').textContent = caption;
    $('imageDialog').showModal();
  }

  function exportData() {
    const payload = {
      app: '口腔衛生学 暗記アプリ',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      baseQuestionCount: BASE_DATA.length,
      state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `口腔衛生学_学習問題データ_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = safeJson(String(reader.result));
      const imported = parsed?.state || parsed;
      if (!imported || typeof imported !== 'object') {
        alert('このファイルは読み込めませんでした。');
        return;
      }
      if (!confirm('現在の学習記録・編集内容を、読み込んだデータで置き換えますか？')) return;
      state = sanitizeState(imported);
      persist('データを読み込みました');
      syncControls();
      populateCategories();
      buildFilteredQuestions({ keepCurrent: true });
    };
    reader.onerror = () => alert('ファイルを読み込めませんでした。');
    reader.readAsText(file);
    $('importFile').value = '';
  }

  function syncControls() {
    $('mode').value = state.settings.mode || 'all';
    $('category').value = state.settings.category || 'all';
    $('order').value = state.settings.order || 'number';
    $('theme').value = state.settings.theme || 'system';
    $('search').value = state.settings.search || '';
    $('managementMode').value = state.settings.managementMode || 'all';
    applyTheme();
  }

  function toast(message, duration = 1800) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  function bindEvents() {
    document.querySelectorAll('.view-tab').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $('mode').addEventListener('change', e => { state.settings.mode = e.target.value; closeAnswerAndFigures(); buildFilteredQuestions({ keepCurrent: true }); persist(); });
    $('category').addEventListener('change', e => { state.settings.category = e.target.value; closeAnswerAndFigures(); buildFilteredQuestions({ keepCurrent: true }); persist(); });
    $('order').addEventListener('change', e => { state.settings.order = e.target.value; closeAnswerAndFigures(); buildFilteredQuestions({ keepCurrent: true, reshuffle: e.target.value === 'shuffle' }); persist(); });
    $('theme').addEventListener('change', e => { state.settings.theme = e.target.value; applyTheme(); persist(); });
    $('search').addEventListener('input', e => { state.settings.search = e.target.value; buildFilteredQuestions({ keepCurrent: true }); persist(); });
    $('clearSearch').addEventListener('click', () => { state.settings.search = ''; $('search').value = ''; buildFilteredQuestions({ keepCurrent: true }); persist(); });
    $('reshuffle').addEventListener('click', () => { state.settings.order = 'shuffle'; $('order').value = 'shuffle'; buildFilteredQuestions({ keepCurrent: true, reshuffle: true }); persist(); });
    $('addQuestionButton').addEventListener('click', () => openEditor());

    $('revealButton').addEventListener('click', revealAnswer);
    $('knownButton').addEventListener('click', () => mark(false));
    $('unknownButton').addEventListener('click', () => mark(true));
    $('prevButton').addEventListener('click', () => move(-1));
    $('nextButton').addEventListener('click', () => move(1));
    $('jumpButton').addEventListener('click', jumpToNumber);
    $('jumpInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); jumpToNumber(); } });
    $('toggleFigures').addEventListener('click', () => {
      figuresVisible = !figuresVisible;
      renderStudy();
      if (!figuresVisible) $('questionText').scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    $('editQuestionButton').addEventListener('click', () => { const q = currentQuestion(); if (q) openEditor(q.id); });
    $('duplicateQuestionButton').addEventListener('click', () => { const q = currentQuestion(); if (q) openEditor(q.id, true); });
    $('deleteQuestionButton').addEventListener('click', () => { const q = currentQuestion(); if (q) deleteQuestion(q.id); });
    $('showAllButton').addEventListener('click', () => { state.settings.mode = 'all'; state.settings.category = 'all'; state.settings.search = ''; syncControls(); buildFilteredQuestions({ keepCurrent: false }); persist(); });
    $('collapseAllAnswers').addEventListener('click', () => $('questionList').querySelectorAll('details[open]').forEach(d => d.removeAttribute('open')));
    $('managementMode').addEventListener('change', e => { state.settings.managementMode = e.target.value; renderManagementList(); persist(); });

    $('editorForm').addEventListener('submit', saveEditor);
    $('closeEditorButton').addEventListener('click', () => $('editorDialog').close());
    $('editorFigureInput').addEventListener('change', e => addEditorImageFiles(e.target.files));
    $('resetOriginalButton').addEventListener('click', () => { if (editingId) resetQuestionToOriginal(editingId); });
    $('closeImageDialog').addEventListener('click', () => $('imageDialog').close());
    $('imageDialog').addEventListener('click', e => { if (e.target === $('imageDialog')) $('imageDialog').close(); });

    $('exportButton').addEventListener('click', exportData);
    $('importFile').addEventListener('change', e => importData(e.target.files[0]));
    $('resetUnknownButton').addEventListener('click', () => {
      if (!confirm('「分からない」の記録をすべて消しますか？')) return;
      state.unknownIds = [];
      persist('「分からない」の記録を消しました');
      buildFilteredQuestions({ keepCurrent: true });
    });
    $('resetEditsButton').addEventListener('click', () => {
      if (!confirm('問題の編集・追加・削除をすべて初期化しますか？\n学習記録は残ります。')) return;
      state.edits = {};
      state.customQuestions = [];
      state.deletedIds = [];
      state.nextCustomNumber = BASE_MAX + 1;
      persist('問題データを初期化しました');
      populateCategories();
      buildFilteredQuestions({ keepCurrent: false });
    });
    $('resetAllButton').addEventListener('click', () => {
      if (!confirm('学習記録・編集内容・追加問題・設定をすべて初期化しますか？\nこの操作は元に戻せません。')) return;
      state = defaultState();
      localStorage.removeItem(STORAGE_KEY);
      persist('すべて初期化しました');
      syncControls();
      populateCategories();
      buildFilteredQuestions({ keepCurrent: false });
    });

    document.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (state.settings.view !== 'study') return;
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
      if (e.key === ' ' && !answerVisible) { e.preventDefault(); revealAnswer(); }
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $('installButton').hidden = false;
    });
    $('installButton').addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('installButton').hidden = true;
    });
  }

  function init() {
    populateCategories();
    syncControls();
    bindEvents();
    const all = getAllQuestions();
    const savedIndex = all.findIndex(q => q.id === state.currentId);
    if (savedIndex < 0 && all.length) state.currentId = all[0].id;
    buildFilteredQuestions({ keepCurrent: true });
    updateSavedAt();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
