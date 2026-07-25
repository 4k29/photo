import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import exifr from "https://esm.sh/exifr@7?bundle";
import QRCode from "https://esm.sh/qrcode@1.5.4";
import { toPng } from "https://esm.sh/html-to-image@1.11.13";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  APP_NAME,
  MAX_PHOTOS_PER_DAY,
} from "./config.js";

const root = document.querySelector("#app");
const isConfigured =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.startsWith("YOUR_") &&
  !SUPABASE_ANON_KEY.startsWith("YOUR_");

const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const state = {
  session: null,
  trip: null,
  photos: [],
};

window.addEventListener("popstate", () => route());
window.addEventListener("DOMContentLoaded", init);

async function init() {
  if (!isConfigured) {
    renderSetup();
    return;
  }

  const { data } = await supabase.auth.getSession();
  state.session = data.session;

  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === "SIGNED_OUT") go({});
  });

  await route();
}

async function route() {
  try {
    const params = new URLSearchParams(location.search);
    const publicSlug = params.get("t");
    const tripId = params.get("trip");
    const view = params.get("view") || "home";

    if (publicSlug) return await renderPublicTrip(publicSlug);
    if (tripId) return await renderTripEditor(tripId);
    if (view === "dashboard") return await renderDashboard();
    if (view === "auth") return renderAuth(params.get("mode") || "login");
    return renderLanding();
  } catch (error) {
    console.error(error);
    renderError(error?.message || "ページを読み込めませんでした。");
  }
}

function go(params = {}) {
  const url = new URL(location.href);
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  history.pushState({}, "", url);
  route();
}

function publicTripUrl(slug) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("t", slug);
  return url.toString();
}

function header({ back = null } = {}) {
  const signedIn = Boolean(state.session);
  return `
    <header class="site-header">
      <div class="container header-inner">
        <button class="btn ghost small" id="brand-button" type="button">${back ? "← " : ""}<span class="brand">${escapeHtml(APP_NAME)}</span></button>
        <div class="header-actions">
          ${
            signedIn
              ? `<button class="btn secondary small" id="dashboard-button" type="button">My Trips</button>
                 <button class="btn ghost small" id="signout-button" type="button">ログアウト</button>`
              : `<button class="btn secondary small" id="login-button" type="button">ログイン</button>`
          }
        </div>
      </div>
    </header>`;
}

function bindHeader({ back = null } = {}) {
  document.querySelector("#brand-button")?.addEventListener("click", () => {
    if (back) go(back);
    else go({});
  });
  document.querySelector("#dashboard-button")?.addEventListener("click", () => go({ view: "dashboard" }));
  document.querySelector("#login-button")?.addEventListener("click", () => go({ view: "auth" }));
  document.querySelector("#signout-button")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}

function renderSetup() {
  root.innerHTML = `
    <div class="shell">
      ${header()}
      <main class="setup card stack">
        <div>
          <p class="eyebrow">Setup required</p>
          <h2>Supabaseを接続してください</h2>
          <p class="lead">アプリ本体は読み込めています。Supabaseでプロジェクトを作成し、<code>supabase/schema.sql</code>を実行したあと、<code>config.js</code>へURLとAnon keyを入力すると利用できます。</p>
        </div>
        <p class="help">秘密鍵ではなく、公開用のAnon keyを設定してください。詳しい手順はREADMEに記載しています。</p>
      </main>
    </div>`;
  bindHeader();
}

function renderLanding() {
  root.innerHTML = `
    <div class="shell">
      ${header()}
      <main class="hero">
        <div class="container hero-grid">
          <section>
            <p class="eyebrow">9 photos a day</p>
            <h1>旅を、<br>一枚のチケットに。</h1>
            <p class="lead">出発地と行き先、誰と行ったか。そして、撮った順に並ぶ1日9枚までの写真。QRコードから、あの日の旅をそのまま振り返れます。</p>
            <div class="hero-actions">
              <button class="btn" id="primary-action" type="button">${state.session ? "自分の旅を見る" : "アカウントを作る"}</button>
              ${state.session ? "" : '<button class="btn secondary" id="secondary-action" type="button">ログイン</button>'}
            </div>
          </section>
          <section id="hero-ticket"></section>
        </div>
      </main>
    </div>`;

  bindHeader();
  document.querySelector("#primary-action")?.addEventListener("click", () =>
    go(state.session ? { view: "dashboard" } : { view: "auth", mode: "signup" }),
  );
  document.querySelector("#secondary-action")?.addEventListener("click", () => go({ view: "auth" }));

  const demoTrip = {
    id: "demo",
    slug: "demo",
    origin: "TOKYO",
    destination: "NAGANO",
    starts_on: "2026-07-25",
    ends_on: "2026-07-25",
    traveler_names: ["YOU", "FRIEND"],
  };
  renderTicketInto(document.querySelector("#hero-ticket"), demoTrip, "https://example.com");
}

function renderAuth(initialMode = "login") {
  if (state.session) {
    go({ view: "dashboard" });
    return;
  }

  let mode = initialMode === "signup" ? "signup" : "login";

  const draw = () => {
    root.innerHTML = `
      <div class="shell">
        ${header({ back: {} })}
        <main class="auth-wrap container">
          <section class="auth-card card">
            <div class="auth-switch">
              <button type="button" data-mode="login" class="${mode === "login" ? "active" : ""}">ログイン</button>
              <button type="button" data-mode="signup" class="${mode === "signup" ? "active" : ""}">新規登録</button>
            </div>
            <h2>${mode === "login" ? "おかえりなさい" : "旅を残しはじめる"}</h2>
            <p class="muted">${mode === "login" ? "メールアドレスとパスワードを入力してください。" : "アカウントを作ると、自分だけの旅行チケットを作成できます。"}</p>
            <form id="auth-form" class="stack">
              ${
                mode === "signup"
                  ? `<div class="field"><label for="display-name">表示名</label><input class="input" id="display-name" name="displayName" autocomplete="name" maxlength="40" required></div>`
                  : ""
              }
              <div class="field"><label for="email">メールアドレス</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
              <div class="field"><label for="password">パスワード</label><input class="input" id="password" name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="8" required></div>
              <p id="auth-message" class="help"></p>
              <button class="btn" id="auth-submit" type="submit">${mode === "login" ? "ログイン" : "アカウントを作成"}</button>
            </form>
          </section>
        </main>
      </div>`;

    bindHeader({ back: {} });
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        mode = button.dataset.mode;
        draw();
      });
    });

    document.querySelector("#auth-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") || "").trim();
      const password = String(form.get("password") || "");
      const displayName = String(form.get("displayName") || "").trim();
      const button = document.querySelector("#auth-submit");
      const message = document.querySelector("#auth-message");
      button.disabled = true;
      message.className = "help";
      message.textContent = "処理しています…";

      const result =
        mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { data: { display_name: displayName } },
            })
          : await supabase.auth.signInWithPassword({ email, password });

      button.disabled = false;
      if (result.error) {
        message.className = "error";
        message.textContent = authErrorMessage(result.error.message);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        message.className = "success";
        message.textContent = "確認メールを送りました。メール内のリンクを開いてからログインしてください。";
        return;
      }

      state.session = result.data.session;
      go({ view: "dashboard" });
    });
  };

  draw();
}

async function renderDashboard() {
  if (!state.session) {
    go({ view: "auth" });
    return;
  }

  root.innerHTML = `<div class="shell">${header()}<main class="loading">旅を読み込んでいます…</main></div>`;
  bindHeader();

  const { data: trips, error } = await supabase
    .from("trips")
    .select("*")
    .eq("owner_id", state.session.user.id)
    .order("starts_on", { ascending: false });
  if (error) throw error;

  root.innerHTML = `
    <div class="shell">
      ${header()}
      <main class="page container">
        <div class="page-head">
          <div>
            <p class="eyebrow">My Trips</p>
            <h2>旅のチケット</h2>
            <p class="muted">${escapeHtml(state.session.user.email || "")}</p>
          </div>
          <button class="btn" id="new-trip-button" type="button">新しい旅を作る</button>
        </div>

        <section id="new-trip-panel" class="card" hidden>
          <form id="new-trip-form" class="stack">
            <div class="field"><label for="trip-title">旅の名前</label><input class="input" id="trip-title" name="title" maxlength="80" placeholder="夏の長野旅行" required></div>
            <div class="grid-2">
              <div class="field"><label for="origin">出発地</label><input class="input" id="origin" name="origin" maxlength="40" placeholder="東京" required></div>
              <div class="field"><label for="destination">行き先</label><input class="input" id="destination" name="destination" maxlength="40" placeholder="長野" required></div>
            </div>
            <div class="grid-2">
              <div class="field"><label for="starts-on">出発日</label><input class="input" id="starts-on" name="startsOn" type="date" required></div>
              <div class="field"><label for="ends-on">帰着日</label><input class="input" id="ends-on" name="endsOn" type="date" required></div>
            </div>
            <div class="field"><label for="travelers">一緒に行った人</label><input class="input" id="travelers" name="travelers" maxlength="200" placeholder="名前を「,」で区切る"></div>
            <p id="new-trip-message" class="help">あとから変更できます。</p>
            <div class="hero-actions"><button class="btn" type="submit" id="create-trip-button">作成</button><button class="btn ghost" type="button" id="cancel-trip-button">キャンセル</button></div>
          </form>
        </section>

        <section class="section">
          ${
            trips.length
              ? `<div class="trip-list">${trips.map(tripCardMarkup).join("")}</div>`
              : `<div class="empty"><p>まだ旅がありません。</p><p class="help">最初のチケットを作ってみよう。</p></div>`
          }
        </section>
      </main>
    </div>`;

  bindHeader();
  const panel = document.querySelector("#new-trip-panel");
  document.querySelector("#new-trip-button")?.addEventListener("click", () => {
    panel.hidden = false;
    document.querySelector("#trip-title")?.focus();
  });
  document.querySelector("#cancel-trip-button")?.addEventListener("click", () => (panel.hidden = true));
  document.querySelectorAll("[data-trip-id]").forEach((card) => {
    card.addEventListener("click", () => go({ trip: card.dataset.tripId }));
  });

  document.querySelector("#new-trip-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startsOn = String(form.get("startsOn"));
    const endsOn = String(form.get("endsOn"));
    const message = document.querySelector("#new-trip-message");
    const button = document.querySelector("#create-trip-button");

    if (endsOn < startsOn) {
      message.className = "error";
      message.textContent = "帰着日は出発日以降にしてください。";
      return;
    }

    button.disabled = true;
    const payload = {
      owner_id: state.session.user.id,
      title: String(form.get("title") || "").trim(),
      origin: String(form.get("origin") || "").trim(),
      destination: String(form.get("destination") || "").trim(),
      starts_on: startsOn,
      ends_on: endsOn,
      traveler_names: splitTravelers(String(form.get("travelers") || "")),
      slug: randomSlug(),
      visibility: "unlisted",
    };

    const { data, error: createError } = await supabase.from("trips").insert(payload).select().single();
    button.disabled = false;
    if (createError) {
      message.className = "error";
      message.textContent = createError.message;
      return;
    }
    go({ trip: data.id });
  });
}

function tripCardMarkup(trip) {
  return `
    <button class="trip-card" data-trip-id="${escapeHtml(trip.id)}" type="button">
      <div>
        <p class="eyebrow">${escapeHtml(trip.title)}</p>
        <div class="route"><span>${escapeHtml(trip.origin)}</span><span class="route-arrow">→</span><span>${escapeHtml(trip.destination)}</span></div>
      </div>
      <div class="trip-meta">${formatDateRange(trip.starts_on, trip.ends_on)}<br>${escapeHtml((trip.traveler_names || []).join(" / ") || "ひとり旅")}</div>
    </button>`;
}

async function renderTripEditor(tripId) {
  if (!state.session) {
    go({ view: "auth" });
    return;
  }

  root.innerHTML = `<div class="shell">${header({ back: { view: "dashboard" } })}<main class="loading">旅を読み込んでいます…</main></div>`;
  bindHeader({ back: { view: "dashboard" } });

  const { data: trip, error: tripError } = await supabase.from("trips").select("*").eq("id", tripId).single();
  if (tripError) throw tripError;
  const photos = await fetchPhotos(trip.id);
  state.trip = trip;
  state.photos = photos;

  const publicUrl = publicTripUrl(trip.slug);
  const qrDataUrl = await qrFor(publicUrl);

  root.innerHTML = `
    <div class="shell">
      ${header({ back: { view: "dashboard" } })}
      <main class="page container">
        <div class="page-head">
          <div><p class="eyebrow">Edit Trip</p><h2>${escapeHtml(trip.title)}</h2><p class="muted">1日${MAX_PHOTOS_PER_DAY}枚まで・撮影順に自動整列</p></div>
          <button class="btn secondary" id="open-public-button" type="button">公開ページを見る</button>
        </div>

        <div class="editor-layout">
          <section class="stack">
            <form id="trip-form" class="card stack">
              <div class="field"><label for="edit-title">旅の名前</label><input class="input" id="edit-title" name="title" value="${escapeAttr(trip.title)}" maxlength="80" required></div>
              <div class="grid-2">
                <div class="field"><label for="edit-origin">出発地</label><input class="input" id="edit-origin" name="origin" value="${escapeAttr(trip.origin)}" maxlength="40" required></div>
                <div class="field"><label for="edit-destination">行き先</label><input class="input" id="edit-destination" name="destination" value="${escapeAttr(trip.destination)}" maxlength="40" required></div>
              </div>
              <div class="grid-2">
                <div class="field"><label for="edit-starts">出発日</label><input class="input" id="edit-starts" name="startsOn" type="date" value="${escapeAttr(trip.starts_on)}" required></div>
                <div class="field"><label for="edit-ends">帰着日</label><input class="input" id="edit-ends" name="endsOn" type="date" value="${escapeAttr(trip.ends_on)}" required></div>
              </div>
              <div class="field"><label for="edit-travelers">一緒に行った人</label><input class="input" id="edit-travelers" name="travelers" value="${escapeAttr((trip.traveler_names || []).join(", "))}" maxlength="200"></div>
              <div class="field"><label for="edit-visibility">公開範囲</label><select class="select" id="edit-visibility" name="visibility"><option value="unlisted" ${trip.visibility === "unlisted" ? "selected" : ""}>QR・リンクを知っている人</option><option value="public" ${trip.visibility === "public" ? "selected" : ""}>公開</option><option value="private" ${trip.visibility === "private" ? "selected" : ""}>自分だけ</option></select></div>
              <p id="trip-form-message" class="help"></p>
              <button class="btn" id="save-trip-button" type="submit">変更を保存</button>
            </form>

            <section class="card">
              <div class="section-head"><div><h3>写真を追加</h3><p class="help">撮影日時を読み取り、日ごとに自動で並べます。</p></div></div>
              <div class="upload-zone" id="upload-zone">
                <input id="photo-input" type="file" accept="image/*" multiple>
                <strong>写真を選ぶ</strong>
                <p class="help">ここへドラッグ＆ドロップもできます</p>
              </div>
              <p id="upload-message" class="help"></p>
              <div class="progress" id="upload-progress" hidden><span style="width:0%"></span></div>
            </section>
          </section>

          <aside class="sticky stack">
            <div id="editor-ticket">${ticketMarkup(trip, qrDataUrl)}</div>
            <div class="grid-2">
              <button class="btn secondary" id="copy-link-button" type="button">リンクをコピー</button>
              <button class="btn secondary" id="save-ticket-button" type="button">画像で保存</button>
            </div>
          </aside>
        </div>

        <section class="section">
          <div class="section-head"><div><h2>Photos</h2><p class="muted">${photos.length}枚</p></div></div>
          <div id="photo-days">${photoDaysMarkup(photos, true)}</div>
        </section>
      </main>
    </div>`;

  bindHeader({ back: { view: "dashboard" } });
  bindEditorEvents(trip, publicUrl);
}

function bindEditorEvents(trip, publicUrl) {
  document.querySelector("#open-public-button")?.addEventListener("click", () => window.open(publicUrl, "_blank", "noopener"));
  document.querySelector("#copy-link-button")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(publicUrl);
    toast("公開リンクをコピーしました");
  });
  document.querySelector("#save-ticket-button")?.addEventListener("click", async () => {
    const button = document.querySelector("#save-ticket-button");
    button.disabled = true;
    try {
      const dataUrl = await toPng(document.querySelector("#ticket-card"), {
        pixelRatio: 2,
        backgroundColor: "#f3efe6",
      });
      const link = document.createElement("a");
      link.download = `${safeFilename(trip.title)}-ticket.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error(error);
      toast("チケット画像を保存できませんでした");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#trip-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startsOn = String(form.get("startsOn"));
    const endsOn = String(form.get("endsOn"));
    const message = document.querySelector("#trip-form-message");
    const button = document.querySelector("#save-trip-button");
    if (endsOn < startsOn) {
      message.className = "error";
      message.textContent = "帰着日は出発日以降にしてください。";
      return;
    }

    button.disabled = true;
    const payload = {
      title: String(form.get("title") || "").trim(),
      origin: String(form.get("origin") || "").trim(),
      destination: String(form.get("destination") || "").trim(),
      starts_on: startsOn,
      ends_on: endsOn,
      traveler_names: splitTravelers(String(form.get("travelers") || "")),
      visibility: String(form.get("visibility") || "unlisted"),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("trips").update(payload).eq("id", trip.id);
    button.disabled = false;
    if (error) {
      message.className = "error";
      message.textContent = error.message;
      return;
    }
    message.className = "success";
    message.textContent = "保存しました。";
    setTimeout(() => renderTripEditor(trip.id), 350);
  });

  const input = document.querySelector("#photo-input");
  input?.addEventListener("change", () => uploadPhotos([...input.files]));
  const zone = document.querySelector("#upload-zone");
  zone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag");
  });
  zone?.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone?.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag");
    uploadPhotos([...event.dataTransfer.files].filter((file) => file.type.startsWith("image/")));
  });

  document.querySelectorAll("[data-delete-photo]").forEach((button) => {
    button.addEventListener("click", async () => {
      const photo = state.photos.find((item) => item.id === button.dataset.deletePhoto);
      if (!photo || !confirm("この写真を削除しますか？")) return;
      button.disabled = true;
      const { error: storageError } = await supabase.storage.from("trip-photos").remove([photo.storage_path]);
      if (storageError) console.warn(storageError);
      const { error } = await supabase.from("photos").delete().eq("id", photo.id);
      if (error) {
        toast("写真を削除できませんでした");
        button.disabled = false;
        return;
      }
      toast("写真を削除しました");
      renderTripEditor(state.trip.id);
    });
  });
}

async function uploadPhotos(files) {
  if (!files.length) return;
  const message = document.querySelector("#upload-message");
  const progress = document.querySelector("#upload-progress");
  const bar = progress.querySelector("span");
  message.className = "help";
  message.textContent = "撮影日時を確認しています…";

  const prepared = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const takenAt = await readTakenAt(file);
    prepared.push({ file, takenAt, takenOn: localDateKey(takenAt) });
  }

  const counts = countByDay(state.photos);
  for (const item of prepared) counts[item.takenOn] = (counts[item.takenOn] || 0) + 1;
  const overDay = Object.entries(counts).find(([, count]) => count > MAX_PHOTOS_PER_DAY);
  if (overDay) {
    message.className = "error";
    message.textContent = `${formatDate(overDay[0])}は合計${overDay[1]}枚になります。1日${MAX_PHOTOS_PER_DAY}枚まで選び直してください。`;
    return;
  }

  progress.hidden = false;
  let completed = 0;
  for (const item of prepared.sort((a, b) => a.takenAt - b.takenAt)) {
    message.textContent = `${completed + 1} / ${prepared.length}枚を保存しています…`;
    const extension = fileExtension(item.file);
    const path = `${state.trip.id}/${state.session.user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("trip-photos").upload(path, item.file, {
      cacheControl: "31536000",
      upsert: false,
      contentType: item.file.type || "image/jpeg",
    });
    if (uploadError) {
      message.className = "error";
      message.textContent = uploadError.message;
      progress.hidden = true;
      return;
    }

    const { error: insertError } = await supabase.from("photos").insert({
      trip_id: state.trip.id,
      owner_id: state.session.user.id,
      storage_path: path,
      taken_at: item.takenAt.toISOString(),
      taken_on: item.takenOn,
      original_name: item.file.name,
    });
    if (insertError) {
      await supabase.storage.from("trip-photos").remove([path]);
      message.className = "error";
      message.textContent = insertError.message;
      progress.hidden = true;
      return;
    }

    completed += 1;
    bar.style.width = `${Math.round((completed / prepared.length) * 100)}%`;
  }

  message.className = "success";
  message.textContent = `${completed}枚を追加しました。`;
  setTimeout(() => renderTripEditor(state.trip.id), 450);
}

async function renderPublicTrip(slug) {
  root.innerHTML = `<div class="shell"><main class="loading">旅を読み込んでいます…</main></div>`;
  const { data: trip, error } = await supabase.from("trips").select("*").eq("slug", slug).single();
  if (error || !trip) {
    root.innerHTML = `<div class="shell">${header()}<main class="auth-wrap container"><div class="card"><h2>この旅は見つかりません</h2><p class="muted">非公開になったか、リンクが正しくない可能性があります。</p><button class="btn" id="home-button" type="button">ホームへ</button></div></main></div>`;
    bindHeader();
    document.querySelector("#home-button")?.addEventListener("click", () => go({}));
    return;
  }

  const photos = await fetchPhotos(trip.id);
  const publicUrl = publicTripUrl(trip.slug);
  const qrDataUrl = await qrFor(publicUrl);
  document.title = `${trip.title} - ${APP_NAME}`;

  root.innerHTML = `
    <div class="shell">
      ${header()}
      <main class="public-wrap narrow">
        <div class="public-title"><p class="eyebrow">${formatDateRange(trip.starts_on, trip.ends_on)}</p><h1>${escapeHtml(trip.title)}</h1><p class="muted">${escapeHtml((trip.traveler_names || []).join(" / ") || "ひとり旅")}</p></div>
        <div id="public-ticket">${ticketMarkup(trip, qrDataUrl)}</div>
        <section class="public-gallery">
          ${photos.length ? photoDaysMarkup(photos, false) : '<div class="empty">まだ写真はありません。</div>'}
        </section>
      </main>
    </div>`;
  bindHeader();
}

async function fetchPhotos(tripId) {
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("trip_id", tripId)
    .order("taken_at", { ascending: true });
  if (error) throw error;

  return await Promise.all(
    data.map(async (photo) => {
      const { data: signed, error: signError } = await supabase.storage
        .from("trip-photos")
        .createSignedUrl(photo.storage_path, 60 * 60);
      return { ...photo, image_url: signError ? "" : signed.signedUrl };
    }),
  );
}

function photoDaysMarkup(photos, editable) {
  if (!photos.length) return '<div class="empty">写真を追加すると、撮影日ごとにここへ並びます。</div>';
  const groups = groupByDay(photos);
  return Object.entries(groups)
    .map(([day, dayPhotos]) => {
      const slots = editable
        ? Array.from({ length: MAX_PHOTOS_PER_DAY - dayPhotos.length }, () => '<div class="photo-placeholder">+</div>').join("")
        : "";
      return `<section class="day-block"><div class="day-title"><h3>${formatDate(day)}</h3><span class="muted">${dayPhotos.length} / ${MAX_PHOTOS_PER_DAY}</span></div><div class="photo-grid">${dayPhotos
        .map((photo) => photoMarkup(photo, editable))
        .join("")}${slots}</div></section>`;
    })
    .join("");
}

function photoMarkup(photo, editable) {
  return `<figure class="photo">${
    photo.image_url
      ? `<img src="${escapeAttr(photo.image_url)}" alt="${escapeAttr(photo.original_name || "旅の写真")}" loading="lazy">`
      : '<div class="loading">読込失敗</div>'
  }<span class="photo-time">${formatTime(photo.taken_at)}</span>${editable ? `<button class="photo-delete" type="button" aria-label="写真を削除" data-delete-photo="${escapeAttr(photo.id)}">×</button>` : ""}</figure>`;
}

async function renderTicketInto(element, trip, url) {
  if (!element) return;
  element.innerHTML = ticketMarkup(trip, await qrFor(url));
}

function ticketMarkup(trip, qrDataUrl) {
  return `
    <article class="ticket" id="ticket-card">
      <div class="ticket-top"><span class="ticket-brand">${escapeHtml(APP_NAME.toUpperCase())}</span><span class="ticket-code">${escapeHtml((trip.slug || trip.id || "TICKET").slice(0, 12).toUpperCase())}</span></div>
      <div class="ticket-route">
        <div class="ticket-place"><div class="ticket-label">FROM</div><div class="ticket-city">${escapeHtml(trip.origin)}</div></div>
        <div class="ticket-arrow">→</div>
        <div class="ticket-place"><div class="ticket-label">TO</div><div class="ticket-city">${escapeHtml(trip.destination)}</div></div>
      </div>
      <div class="ticket-rule"></div>
      <div class="ticket-bottom">
        <div><div class="ticket-label">DATE</div><div class="ticket-value">${formatDateRange(trip.starts_on, trip.ends_on)}</div></div>
        <div><div class="ticket-label">TRAVELERS</div><div class="ticket-value">${escapeHtml((trip.traveler_names || []).join(" / ") || "SOLO")}</div></div>
        <div class="ticket-qr"><img src="${escapeAttr(qrDataUrl)}" alt="旅行ページのQRコード"></div>
      </div>
    </article>`;
}

async function qrFor(value) {
  return await QRCode.toDataURL(value, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#111111", light: "#ffffff" },
  });
}

async function readTakenAt(file) {
  try {
    const metadata = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "ModifyDate"]);
    const value = metadata?.DateTimeOriginal || metadata?.CreateDate || metadata?.ModifyDate;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  } catch (error) {
    console.warn("EXIFを読み取れませんでした", error);
  }
  const fallback = new Date(file.lastModified || Date.now());
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

function groupByDay(photos) {
  return photos.reduce((groups, photo) => {
    (groups[photo.taken_on] ||= []).push(photo);
    return groups;
  }, {});
}

function countByDay(photos) {
  return photos.reduce((counts, photo) => {
    counts[photo.taken_on] = (counts[photo.taken_on] || 0) + 1;
    return counts;
  }, {});
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function formatDateRange(start, end) {
  if (!start) return "";
  if (!end || start === end) return formatDate(start);
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const first = new Intl.DateTimeFormat("ja-JP", {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(startDate);
  const last = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(endDate);
  return `${first} – ${last}`;
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function splitTravelers(value) {
  return value
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function randomSlug() {
  return `${Date.now().toString(36)}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function fileExtension(file) {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  const fromType = file.type.split("/").pop()?.replace("jpeg", "jpg");
  return fromType || "jpg";
}

function safeFilename(value) {
  return String(value || "travel")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function authErrorMessage(message) {
  const lower = String(message).toLowerCase();
  if (lower.includes("invalid login")) return "メールアドレスまたはパスワードが違います。";
  if (lower.includes("already registered")) return "このメールアドレスはすでに登録されています。";
  if (lower.includes("password")) return "パスワードは8文字以上にしてください。";
  return message;
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 2300);
}

function renderError(message) {
  root.innerHTML = `<div class="shell">${header()}<main class="auth-wrap container"><section class="card"><h2>エラーが発生しました</h2><p class="muted">${escapeHtml(message)}</p><button class="btn" id="retry-button" type="button">ホームへ戻る</button></section></main></div>`;
  bindHeader();
  document.querySelector("#retry-button")?.addEventListener("click", () => go({}));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
